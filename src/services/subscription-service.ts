import { and, eq, inArray, sql } from "drizzle-orm";

import { getOwnerIdFromUsername } from "../api/github-client";
import {
  getUserProfile,
  validateRepository,
  type RepositoryInfo,
  type UserProfile,
} from "../api/user-oauth-client";
import {
  DEFAULT_EVENT_TYPES,
  PENDING_MESSAGE_CLEANUP_INTERVAL_MS,
  PENDING_MESSAGE_MAX_AGE_MS,
  PENDING_SUBSCRIPTION_CLEANUP_INTERVAL_MS,
  PENDING_SUBSCRIPTION_EXPIRATION_MS,
} from "../constants";
import { db } from "../db";
import { githubSubscriptions, pendingSubscriptions } from "../db/schema";
import {
  generateInstallUrl,
  InstallationService,
} from "../github-app/installation-service";
import type { TownsBot } from "../types/bot";
import { GitHubOAuthService } from "./github-oauth-service";

/**
 * Subscription request parameters
 */
export interface SubscribeParams {
  townsUserId: string;
  spaceId: string;
  channelId: string;
  repoIdentifier: string; // Format: "owner/repo"
  eventTypes?: string;
}

/**
 * Subscription result - discriminated union for type safety
 */
export type SubscribeResult = SubscribeSuccess | SubscribeFailure;

type SubscribeSuccess =
  | {
      success: true;
      deliveryMode: "webhook";
      repoFullName: string;
      eventTypes: string;
    }
  | {
      success: true;
      deliveryMode: "polling";
      repoFullName: string;
      eventTypes: string;
      installUrl: string;
    };

type SubscribeFailure =
  | { success: false; requiresInstallation: false; error: string }
  | {
      success: false;
      requiresInstallation: true;
      installUrl: string;
      repoFullName: string;
      eventTypes: string;
      error: string;
    };

/**
 * SubscriptionService - OAuth-first subscription management
 *
 * Implements the full subscription flow from GITHUB_APP_IMPLEMENTATION_PLAN.md:
 * - Requires OAuth for all subscriptions
 * - Validates repository access with user's token
 * - Determines delivery mode (webhook vs polling)
 * - Private repos require GitHub App installation
 * - Public repos fall back to polling if GitHub App not installed
 */
export class SubscriptionService {
  private pendingMessages = new Map<
    string,
    { eventId: string; channelId: string; timestamp: number }
  >();

  constructor(
    private oauthService: GitHubOAuthService,
    private installationService: InstallationService,
    private bot?: TownsBot
  ) {
    // Clean up stale pending messages periodically
    setInterval(
      () => this.cleanupPendingMessages(),
      PENDING_MESSAGE_CLEANUP_INTERVAL_MS
    );

    // Clean up expired pending subscriptions periodically
    setInterval(() => {
      void this.cleanupExpiredPendingSubscriptions();
    }, PENDING_SUBSCRIPTION_CLEANUP_INTERVAL_MS);
  }

  /**
   * Subscribe a channel to a GitHub repository
   * Implements the full OAuth-first flow from the implementation plan
   */
  async createSubscription(params: SubscribeParams): Promise<SubscribeResult> {
    const { townsUserId, spaceId, channelId, repoIdentifier, eventTypes } =
      params;

    // Normalize event types once to avoid duplication
    const requestedEventTypes = eventTypes || DEFAULT_EVENT_TYPES;

    // Parse owner/repo
    const [owner, repo] = repoIdentifier.split("/");
    if (!owner || !repo) {
      return {
        success: false,
        requiresInstallation: false,
        error: `Invalid repository format. Use: owner/repo`,
      };
    }

    // 1. Get OAuth token (assumes caller has checked OAuth is linked)
    const githubToken = await this.oauthService.getToken(townsUserId);
    if (!githubToken) {
      throw new Error(
        "OAuth token not found. Caller should check OAuth status before calling createSubscription."
      );
    }

    // Get user's GitHub login for tracking
    let githubUser: UserProfile;
    try {
      githubUser = await getUserProfile(githubToken);
    } catch (error) {
      const errorMessage =
        error instanceof Error
          ? error.message
          : "Failed to get GitHub user profile";
      return {
        success: false,
        requiresInstallation: false,
        error: errorMessage,
      };
    }

    // 2. Check if GitHub App is installed (check this first for private repos)
    const installationId =
      await this.installationService.isRepoInstalled(repoIdentifier);

    // 3. Validate repo with OAuth token
    let repoInfo: RepositoryInfo;
    try {
      repoInfo = await validateRepository(githubToken, owner, repo);
    } catch (error) {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
      const status = (error as any)?.cause?.status;

      // If 404 and no installation, might be a private repo that needs installation
      if (status === 404 && !installationId) {
        // Get owner ID from public profile for installation URL
        const ownerId = await getOwnerIdFromUsername(owner);

        // Store pending subscription for completion after installation
        await this.storePendingSubscription({
          townsUserId,
          spaceId,
          channelId,
          repoFullName: repoIdentifier,
          eventTypes: requestedEventTypes,
        });

        return {
          success: false,
          requiresInstallation: true,
          installUrl: generateInstallUrl(ownerId),
          repoFullName: repoIdentifier,
          eventTypes: requestedEventTypes,
          error: `Repository not found or you don't have access.`,
        };
      }

      // Check if this might be an org approval issue
      const isOrgRepo =
        repoIdentifier.includes("/") &&
        !repoIdentifier
          .toLowerCase()
          .startsWith(`${githubUser.login.toLowerCase()}/`);

      const errorMessage =
        status === 403 && isOrgRepo
          ? `Access denied to ${repoIdentifier}. This organization may need to approve the GitHub App. ` +
            `Ask an organization admin to approve the app in GitHub settings.`
          : error instanceof Error
            ? error.message
            : `Failed to validate repository: ${repoIdentifier}`;

      return {
        success: false,
        requiresInstallation: false,
        error: errorMessage,
      };
    }

    // 4. Determine delivery mode based on installation and repo type
    let deliveryMode: "webhook" | "polling";

    if (repoInfo.isPrivate) {
      // Private repos MUST have GitHub App installed
      if (!installationId) {
        // Store pending subscription for completion after installation
        await this.storePendingSubscription({
          townsUserId,
          spaceId,
          channelId,
          repoFullName: repoInfo.fullName,
          eventTypes: requestedEventTypes,
        });

        return {
          success: false,
          requiresInstallation: true,
          installUrl: generateInstallUrl(repoInfo.owner.id),
          repoFullName: repoInfo.fullName,
          eventTypes: requestedEventTypes,
          error: `Private repository requires GitHub App installation`,
        };
      }

      deliveryMode = "webhook";
    } else {
      // Public repos: webhook if available, polling fallback
      deliveryMode = installationId ? "webhook" : "polling";
    }

    // 4. Check if already subscribed
    const existing = await db
      .select()
      .from(githubSubscriptions)
      .where(
        and(
          eq(githubSubscriptions.spaceId, spaceId),
          eq(githubSubscriptions.channelId, channelId),
          eq(githubSubscriptions.repoFullName, repoInfo.fullName)
        )
      )
      .limit(1);

    if (existing.length > 0) {
      return {
        success: false,
        requiresInstallation: false,
        error: `Already subscribed to ${repoInfo.fullName}`,
      };
    }

    // 5. Create subscription
    const now = new Date();
    await db.insert(githubSubscriptions).values({
      spaceId,
      channelId,
      repoFullName: repoInfo.fullName,
      deliveryMode,
      isPrivate: repoInfo.isPrivate,
      createdByTownsUserId: townsUserId,
      createdByGithubLogin: githubUser.login,
      installationId,
      enabled: true,
      eventTypes: requestedEventTypes,
      createdAt: now,
      updatedAt: now,
    });

    if (deliveryMode === "polling") {
      return {
        success: true,
        deliveryMode: "polling",
        repoFullName: repoInfo.fullName,
        eventTypes: requestedEventTypes,
        installUrl: generateInstallUrl(repoInfo.owner.id),
      };
    } else {
      return {
        success: true,
        deliveryMode: "webhook",
        repoFullName: repoInfo.fullName,
        eventTypes: requestedEventTypes,
      };
    }
  }

  /**
   * Store a pending subscription for completion after GitHub App installation
   * Used when user tries to subscribe to private repo before installing GitHub App
   */
  private async storePendingSubscription(params: {
    townsUserId: string;
    spaceId: string;
    channelId: string;
    repoFullName: string;
    eventTypes: string;
  }): Promise<void> {
    const now = new Date();
    const expiresAt = new Date(
      now.getTime() + PENDING_SUBSCRIPTION_EXPIRATION_MS
    );

    await db
      .insert(pendingSubscriptions)
      .values({
        townsUserId: params.townsUserId,
        spaceId: params.spaceId,
        channelId: params.channelId,
        repoFullName: params.repoFullName,
        eventTypes: params.eventTypes,
        createdAt: now,
        expiresAt,
      })
      .onConflictDoNothing();

    console.log(
      `[Subscribe] Stored pending subscription for ${params.repoFullName}`
    );
  }

  /**
   * Complete pending subscriptions for a repository after GitHub App installation
   * Called by InstallationService when repos are added to installation
   * @returns Number of subscriptions completed
   */
  async completePendingSubscriptions(repoFullName: string): Promise<number> {
    // Get all pending subscriptions for this repo
    const pending = await db
      .select()
      .from(pendingSubscriptions)
      .where(eq(pendingSubscriptions.repoFullName, repoFullName));

    if (pending.length === 0) return 0;

    console.log(
      `[Subscribe] Processing ${pending.length} pending subscription(s) for ${repoFullName}`
    );

    let completed = 0;

    // Process each pending subscription
    for (const sub of pending) {
      try {
        // Validate user still has OAuth token
        const token = await this.oauthService.getToken(sub.townsUserId);
        if (!token) {
          console.log(
            `[Subscribe] Skipping pending - user ${sub.townsUserId} no longer has OAuth token`
          );
          continue;
        }

        // Create the subscription (will be webhook mode since installation exists)
        const result = await this.createSubscription({
          townsUserId: sub.townsUserId,
          spaceId: sub.spaceId,
          channelId: sub.channelId,
          repoIdentifier: repoFullName,
          eventTypes: sub.eventTypes,
        });

        if (result.success && this.bot) {
          // Send success notification
          await this.bot.sendMessage(
            sub.channelId,
            `✅ **Subscribed to [${repoFullName}](https://github.com/${repoFullName})**\n\n⚡ Real-time webhook delivery enabled!`
          );
          completed++;
          console.log(
            `[Subscribe] Completed pending subscription for ${repoFullName} in channel ${sub.channelId}`
          );
        }
      } catch (error) {
        console.error(
          `[Subscribe] Failed to complete pending subscription for ${repoFullName}:`,
          error
        );
      }
    }

    // Delete processed pending subscriptions
    await db
      .delete(pendingSubscriptions)
      .where(eq(pendingSubscriptions.repoFullName, repoFullName));

    return completed;
  }

  /**
   * Unsubscribe a channel from a repository
   */
  async unsubscribe(
    channelId: string,
    spaceId: string,
    repoFullName: string
  ): Promise<boolean> {
    const result = await db
      .delete(githubSubscriptions)
      .where(
        and(
          eq(githubSubscriptions.spaceId, spaceId),
          eq(githubSubscriptions.channelId, channelId),
          eq(githubSubscriptions.repoFullName, repoFullName)
        )
      )
      .returning({ id: githubSubscriptions.id });

    return result.length > 0;
  }

  /**
   * Get all subscriptions for a channel
   */
  async getChannelSubscriptions(
    channelId: string,
    spaceId: string
  ): Promise<
    Array<{ repo: string; eventTypes: string; deliveryMode: string }>
  > {
    const results = await db
      .select({
        repo: githubSubscriptions.repoFullName,
        eventTypes: githubSubscriptions.eventTypes,
        deliveryMode: githubSubscriptions.deliveryMode,
      })
      .from(githubSubscriptions)
      .where(
        and(
          eq(githubSubscriptions.channelId, channelId),
          eq(githubSubscriptions.spaceId, spaceId)
        )
      );

    return results.map(r => ({
      repo: r.repo,
      eventTypes: r.eventTypes || DEFAULT_EVENT_TYPES,
      deliveryMode: r.deliveryMode,
    }));
  }

  /**
   * Get all channels subscribed to a repository
   * Used by polling service and event processor
   *
   * @param repoFullName - Repository in owner/repo format
   * @param deliveryMode - Optional filter by delivery mode (webhook/polling)
   *                       Used to prevent duplicate notifications
   */
  async getRepoSubscribers(
    repoFullName: string,
    deliveryMode?: "webhook" | "polling"
  ): Promise<Array<{ channelId: string; eventTypes: string }>> {
    const conditions = [eq(githubSubscriptions.repoFullName, repoFullName)];

    if (deliveryMode) {
      conditions.push(eq(githubSubscriptions.deliveryMode, deliveryMode));
    }

    const results = await db
      .select({
        channelId: githubSubscriptions.channelId,
        eventTypes: githubSubscriptions.eventTypes,
      })
      .from(githubSubscriptions)
      .where(and(...conditions));

    return results.map(r => ({
      channelId: r.channelId,
      eventTypes: r.eventTypes || DEFAULT_EVENT_TYPES,
    }));
  }

  /**
   * Get all unique repositories with at least one subscriber
   * Used by health endpoint for reporting subscribed repos
   */
  async getAllSubscribedRepos(): Promise<string[]> {
    const results = await db
      .selectDistinct({ repo: githubSubscriptions.repoFullName })
      .from(githubSubscriptions);

    return results.map(r => r.repo);
  }

  /**
   * Get all unique repositories that use polling mode
   * Used by polling service to avoid polling repos with webhooks
   */
  async getPollingRepos(): Promise<string[]> {
    const results = await db
      .selectDistinct({ repo: githubSubscriptions.repoFullName })
      .from(githubSubscriptions)
      .where(eq(githubSubscriptions.deliveryMode, "polling"));

    return results.map(r => r.repo);
  }

  /**
   * Downgrade subscriptions when GitHub App access is removed
   *
   * Handles both full installation deletion and specific repository removal.
   * Public repos are downgraded to polling mode, private repos are removed.
   *
   * @param installationId - The installation ID
   * @param repos - Optional array of specific repos to downgrade. If undefined, downgrades all repos for the installation.
   * @returns Object with counts of downgraded and removed subscriptions
   */
  async downgradeSubscriptions(
    installationId: number,
    repos?: string[]
  ): Promise<{ downgraded: number; removed: number }> {
    // Empty array means no repos to downgrade (no-op)
    if (repos && repos.length === 0) {
      return { downgraded: 0, removed: 0 };
    }

    // Build WHERE conditions
    const conditions = [eq(githubSubscriptions.installationId, installationId)];
    if (repos && repos.length > 0) {
      conditions.push(inArray(githubSubscriptions.repoFullName, repos));
    }

    // Find affected subscriptions
    const affectedSubs = await db
      .select({
        id: githubSubscriptions.id,
        repoFullName: githubSubscriptions.repoFullName,
        isPrivate: githubSubscriptions.isPrivate,
        channelId: githubSubscriptions.channelId,
      })
      .from(githubSubscriptions)
      .where(and(...conditions));

    if (affectedSubs.length === 0) {
      return { downgraded: 0, removed: 0 };
    }

    // Split into public (can downgrade) and private (must remove)
    const publicRepos = affectedSubs.filter(sub => !sub.isPrivate);
    const privateRepos = affectedSubs.filter(sub => sub.isPrivate);

    // Downgrade/remove subscriptions atomically
    let downgraded = 0;
    let removed = 0;

    await db.transaction(async tx => {
      // Downgrade public repos to polling
      if (publicRepos.length > 0) {
        const publicRepoNames = publicRepos.map(sub => sub.repoFullName);
        const updateConditions = [
          eq(githubSubscriptions.installationId, installationId),
          inArray(githubSubscriptions.repoFullName, publicRepoNames),
          eq(githubSubscriptions.isPrivate, false),
        ];

        const result = await tx
          .update(githubSubscriptions)
          .set({
            deliveryMode: "polling",
            installationId: null,
            updatedAt: new Date(),
          })
          .where(and(...updateConditions))
          .returning({ id: githubSubscriptions.id });

        downgraded = result.length;
      }

      // Remove private repo subscriptions (can't poll private repos)
      if (privateRepos.length > 0) {
        const privateRepoNames = privateRepos.map(sub => sub.repoFullName);
        const deleteConditions = [
          eq(githubSubscriptions.installationId, installationId),
          inArray(githubSubscriptions.repoFullName, privateRepoNames),
          eq(githubSubscriptions.isPrivate, true),
        ];

        const result = await tx
          .delete(githubSubscriptions)
          .where(and(...deleteConditions))
          .returning({ id: githubSubscriptions.id });

        removed = result.length;
      }
    });

    // Notify affected channels (in parallel)
    if (this.bot) {
      await Promise.allSettled([
        ...publicRepos.map(async sub => {
          try {
            await this.bot!.sendMessage(
              sub.channelId,
              `⚠️ **${sub.repoFullName}** removed from GitHub App\n\n` +
                `Downgraded to polling mode (5-minute intervals). ` +
                `Add the repo back to the app installation for real-time webhooks.`
            );
          } catch (error) {
            console.error(
              `Failed to notify channel ${sub.channelId} about downgrade:`,
              error
            );
          }
        }),
        ...privateRepos.map(async sub => {
          try {
            await this.bot!.sendMessage(
              sub.channelId,
              `❌ **${sub.repoFullName}** removed from GitHub App\n\n` +
                `Subscription removed (private repos require app installation). ` +
                `Use \`/github subscribe ${sub.repoFullName}\` to re-subscribe.`
            );
          } catch (error) {
            console.error(
              `Failed to notify channel ${sub.channelId} about removal:`,
              error
            );
          }
        }),
      ]);
    }

    return { downgraded, removed };
  }

  /**
   * Upgrade subscriptions from polling to webhook when GitHub App is installed
   * Called by InstallationService when repos are added to an installation
   */
  async upgradeToWebhook(
    repoFullName: string,
    installationId: number
  ): Promise<number> {
    const result = await db
      .update(githubSubscriptions)
      .set({
        deliveryMode: "webhook",
        installationId,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(githubSubscriptions.repoFullName, repoFullName),
          eq(githubSubscriptions.deliveryMode, "polling")
        )
      )
      .returning({
        id: githubSubscriptions.id,
        channelId: githubSubscriptions.channelId,
      });

    // Update pending Towns messages to reflect webhook upgrade (in parallel)
    await Promise.allSettled(
      result.map(async sub => {
        const key = `${sub.channelId}:${repoFullName}`;
        const pending = this.pendingMessages.get(key);

        if (pending && this.bot) {
          try {
            await this.bot.editMessage(
              pending.channelId,
              pending.eventId,
              `✅ **Subscribed to [${repoFullName}](https://github.com/${repoFullName})**\n\n⚡ Real-time webhook delivery enabled!`
            );
            this.pendingMessages.delete(key);
          } catch (error) {
            console.error(
              `Failed to update subscription message for ${repoFullName}:`,
              error
            );
            // Remove from pending even if edit fails (avoid retry loops)
            this.pendingMessages.delete(key);
          }
        }
      })
    );

    return result.length;
  }

  /**
   * Register a pending subscription message for later updates
   */
  registerPendingMessage(
    channelId: string,
    repoFullName: string,
    eventId: string
  ): void {
    const key = `${channelId}:${repoFullName}`;
    this.pendingMessages.set(key, {
      eventId,
      channelId,
      timestamp: Date.now(),
    });
  }

  /**
   * Clean up stale pending messages
   * Called periodically to prevent memory leaks
   */
  private cleanupPendingMessages(): void {
    const now = Date.now();

    for (const [key, pending] of this.pendingMessages.entries()) {
      if (now - pending.timestamp > PENDING_MESSAGE_MAX_AGE_MS) {
        this.pendingMessages.delete(key);
      }
    }
  }

  /**
   * Clean up expired pending subscriptions
   * Called periodically to remove subscriptions that have expired
   */
  private async cleanupExpiredPendingSubscriptions(): Promise<void> {
    try {
      const result = await db
        .delete(pendingSubscriptions)
        .where(sql`${pendingSubscriptions.expiresAt} < NOW()`)
        .returning({ id: pendingSubscriptions.id });

      if (result.length > 0) {
        console.log(
          `[Subscribe] Cleaned up ${result.length} expired pending subscription(s)`
        );
      }
    } catch (error) {
      console.error(
        "[Subscribe] Failed to clean up expired pending subscriptions:",
        error
      );
    }
  }
}
