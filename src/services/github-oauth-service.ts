import { GitHubApp } from "../github-app/app";
import { db } from "../db";
import { githubUserTokens, oauthStates } from "../db/schema";
import { eq } from "drizzle-orm";
import {
  randomBytes,
  createHash,
  createCipheriv,
  createDecipheriv,
} from "crypto";
import { Octokit } from "@octokit/rest";

/**
 * GitHubOAuthService - Manages OAuth authentication for Towns users
 *
 * Uses Octokit app's built-in OAuth support (app.oauth) to:
 * - Generate authorization URLs
 * - Exchange codes for tokens
 * - Get user-scoped Octokit instances
 *
 * Tokens are encrypted at rest using AES-256-GCM derived from JWT_SECRET.
 */
export class GitHubOAuthService {
  private githubApp: GitHubApp;
  private redirectUrl: string;
  private encryptionKey: Buffer;

  constructor(githubApp: GitHubApp) {
    this.githubApp = githubApp;

    // Validate redirect URL configuration
    const oauthRedirectUrl = process.env.OAUTH_REDIRECT_URL;
    const publicUrl = process.env.PUBLIC_URL;

    if (oauthRedirectUrl) {
      this.redirectUrl = oauthRedirectUrl;
    } else if (publicUrl) {
      this.redirectUrl = `${publicUrl}/oauth/callback`;
    } else {
      throw new Error(
        "OAUTH_REDIRECT_URL or PUBLIC_URL must be configured for OAuth callbacks"
      );
    }

    // Derive 32-byte encryption key from JWT_SECRET using SHA-256
    const jwtSecret = process.env.JWT_SECRET;
    if (!jwtSecret) {
      throw new Error("JWT_SECRET not configured");
    }
    this.encryptionKey = createHash("sha256").update(jwtSecret).digest();
  }

  /**
   * Generate OAuth authorization URL for a Towns user
   *
   * @param townsUserId - Towns user ID
   * @param channelId - Current channel ID
   * @param spaceId - Current space ID
   * @param redirectAction - Action to perform after OAuth (e.g., 'subscribe')
   * @param redirectData - Additional data for redirect (e.g., repo name)
   * @returns Authorization URL to send to user
   */
  async getAuthorizationUrl(
    townsUserId: string,
    channelId: string,
    spaceId: string,
    redirectAction?: string,
    redirectData?: Record<string, any>
  ): Promise<string> {
    // Generate secure state token
    const state = randomBytes(32).toString("hex");

    // Store state in database with 15-minute expiration
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000);
    await db.insert(oauthStates).values({
      state,
      townsUserId,
      channelId,
      spaceId,
      redirectAction: redirectAction || null,
      redirectData: redirectData ? JSON.stringify(redirectData) : null,
      expiresAt,
      createdAt: new Date(),
    });

    // Use Octokit's OAuth to generate authorization URL
    const oauth = this.githubApp.getOAuth();
    if (!oauth) {
      throw new Error("OAuth not configured");
    }

    const { url } = oauth.getWebFlowAuthorizationUrl({
      state,
      redirectUrl: this.redirectUrl,
    });

    return url;
  }

  /**
   * Handle OAuth callback - exchange code for token and store
   *
   * @param code - OAuth authorization code
   * @param state - State parameter for validation
   * @returns OAuth state data with redirect information
   */
  async handleCallback(code: string, state: string) {
    // Validate state and get stored data
    const [stateData] = await db
      .select()
      .from(oauthStates)
      .where(eq(oauthStates.state, state))
      .limit(1);

    if (!stateData) {
      throw new Error("Invalid or expired state parameter");
    }

    // Check expiration
    if (new Date() > stateData.expiresAt) {
      // Clean up expired state
      await db.delete(oauthStates).where(eq(oauthStates.state, state));
      throw new Error("OAuth state expired");
    }

    // Exchange code for token using Octokit
    const oauth = this.githubApp.getOAuth();
    if (!oauth) {
      throw new Error("OAuth not configured");
    }

    const { authentication } = await oauth.createToken({
      code,
      state,
    });

    // Get user profile using the new token
    const userOctokit = await oauth.getUserOctokit({
      token: authentication.token,
    });
    const { data: user } = await userOctokit.request("GET /user");

    // Encrypt access token
    const encryptedToken = this.encryptToken(authentication.token);
    const encryptedRefreshToken = authentication.refreshToken
      ? this.encryptToken(authentication.refreshToken)
      : null;

    // Store or update user token
    const now = new Date();
    await db
      .insert(githubUserTokens)
      .values({
        townsUserId: stateData.townsUserId,
        githubUserId: user.id,
        githubLogin: user.login,
        accessToken: encryptedToken,
        tokenType: authentication.tokenType,
        scope:
          "scopes" in authentication && Array.isArray(authentication.scopes)
            ? authentication.scopes.join(",")
            : null,
        expiresAt: authentication.expiresAt
          ? new Date(authentication.expiresAt)
          : null,
        refreshToken: encryptedRefreshToken,
        refreshTokenExpiresAt: authentication.refreshTokenExpiresAt
          ? new Date(authentication.refreshTokenExpiresAt)
          : null,
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: githubUserTokens.townsUserId,
        set: {
          githubUserId: user.id,
          githubLogin: user.login,
          accessToken: encryptedToken,
          tokenType: authentication.tokenType,
          scope:
            "scopes" in authentication && Array.isArray(authentication.scopes)
              ? authentication.scopes.join(",")
              : null,
          expiresAt: authentication.expiresAt
            ? new Date(authentication.expiresAt)
            : null,
          refreshToken: encryptedRefreshToken,
          refreshTokenExpiresAt: authentication.refreshTokenExpiresAt
            ? new Date(authentication.refreshTokenExpiresAt)
            : null,
          updatedAt: now,
        },
      });

    // Clean up used state
    await db.delete(oauthStates).where(eq(oauthStates.state, state));

    // Return state data for redirect handling
    return {
      townsUserId: stateData.townsUserId,
      channelId: stateData.channelId,
      spaceId: stateData.spaceId,
      redirectAction: stateData.redirectAction,
      redirectData: stateData.redirectData
        ? JSON.parse(stateData.redirectData)
        : null,
      githubLogin: user.login,
    };
  }

  /**
   * Get stored GitHub user token for a Towns user
   *
   * @param townsUserId - Towns user ID
   * @returns User token data or null if not linked
   */
  async getUserToken(townsUserId: string) {
    const [token] = await db
      .select()
      .from(githubUserTokens)
      .where(eq(githubUserTokens.townsUserId, townsUserId))
      .limit(1);

    if (!token) {
      return null;
    }

    // Decrypt token
    return {
      ...token,
      accessToken: this.decryptToken(token.accessToken),
      refreshToken: token.refreshToken
        ? this.decryptToken(token.refreshToken)
        : null,
    };
  }

  /**
   * Get decrypted access token for a Towns user
   *
   * @param townsUserId - Towns user ID
   * @returns Decrypted access token or null if not linked
   */
  async getToken(townsUserId: string): Promise<string | null> {
    const tokenData = await this.getUserToken(townsUserId);
    return tokenData?.accessToken ?? null;
  }

  /**
   * Get user-scoped Octokit instance for API calls
   *
   * @param townsUserId - Towns user ID
   * @returns Authenticated Octokit instance or null if not linked
   */
  async getUserOctokit(townsUserId: string): Promise<Octokit | null> {
    const token = await this.getUserToken(townsUserId);
    if (!token) {
      return null;
    }

    // Create Octokit REST instance with user's access token
    return new Octokit({
      auth: token.accessToken,
    });
  }

  /**
   * Disconnect GitHub account for a Towns user
   *
   * @param townsUserId - Towns user ID
   */
  async disconnect(townsUserId: string) {
    const token = await this.getUserToken(townsUserId);
    if (!token) {
      return;
    }

    // Revoke token on GitHub (optional - token will be invalidated anyway)
    try {
      const oauth = this.githubApp.getOAuth();
      if (oauth) {
        await oauth.deleteToken({
          token: token.accessToken,
        });
      }
    } catch (error) {
      console.error("Failed to revoke token on GitHub:", error);
      // Continue with local deletion even if revocation fails
    }

    // Remove from database
    await db
      .delete(githubUserTokens)
      .where(eq(githubUserTokens.townsUserId, townsUserId));
  }

  /**
   * Check if a Towns user has linked their GitHub account
   *
   * @param townsUserId - Towns user ID
   * @returns true if linked, false otherwise
   */
  async isLinked(townsUserId: string): Promise<boolean> {
    const token = await this.getUserToken(townsUserId);
    return token !== null;
  }

  /**
   * Encrypt token using AES-256-GCM
   */
  private encryptToken(token: string): string {
    const iv = randomBytes(16);
    const cipher = createCipheriv("aes-256-gcm", this.encryptionKey, iv);

    let encrypted = cipher.update(token, "utf8", "hex");
    encrypted += cipher.final("hex");

    const authTag = cipher.getAuthTag();

    // Format: iv:authTag:encrypted
    return `${iv.toString("hex")}:${authTag.toString("hex")}:${encrypted}`;
  }

  /**
   * Decrypt token using AES-256-GCM
   */
  private decryptToken(encryptedToken: string): string {
    const [ivHex, authTagHex, encrypted] = encryptedToken.split(":");

    const iv = Buffer.from(ivHex, "hex");
    const authTag = Buffer.from(authTagHex, "hex");

    const decipher = createDecipheriv("aes-256-gcm", this.encryptionKey, iv);
    decipher.setAuthTag(authTag);

    let decrypted = decipher.update(encrypted, "hex", "utf8");
    decrypted += decipher.final("utf8");

    return decrypted;
  }
}
