import { and, eq } from "drizzle-orm";

import { DEFAULT_EVENT_TYPES } from "../constants/event-types";
import { db } from "../db";
import { githubSubscriptions } from "../db/schema";
import { InstallationService } from "../github-app/installation-service";
import { GitHubOAuthService } from "./github-oauth-service";
import { UserOAuthClient, type RepositoryInfo } from "./user-oauth-client";

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
  constructor(
    private oauthService: GitHubOAuthService,
    private userClient: UserOAuthClient,
    private installationService: InstallationService
  ) {}

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
    const githubUser = await this.userClient.getUserProfile(githubToken);

    // 2. Validate repo with OAuth token
    let repoInfo: RepositoryInfo;
    try {
      repoInfo = await this.userClient.validateRepository(
        githubToken,
        owner,
        repo
      );
    } catch (error) {
      const errorMessage =
        error instanceof Error
          ? error.message
          : `Failed to validate repository: ${repoIdentifier}`;
      return {
        success: false,
        requiresInstallation: false,
        error: errorMessage,
      };
    }

    // 3. Determine delivery mode
    let deliveryMode: "webhook" | "polling";
    const installationId = await this.installationService.isRepoInstalled(
      repoInfo.fullName
    );

    if (repoInfo.isPrivate) {
      // Private repos MUST have GitHub App installed
      if (!installationId) {
        return {
          success: false,
          requiresInstallation: true,
          installUrl: this.generateInstallUrl(repoInfo.owner.id),
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
        installUrl: this.generateInstallUrl(repoInfo.owner.id),
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
      .returning({ id: githubSubscriptions.id });

    return result.length;
  }

  /**
   * Generate GitHub App installation URL
   * @param targetId - Owner ID (user or org)
   * @returns Installation URL
   */
  private generateInstallUrl(targetId: number): string {
    const appSlug = process.env.GITHUB_APP_SLUG || "towns-github-bot";
    return `https://github.com/apps/${appSlug}/installations/new/permissions?target_id=${targetId}`;
  }
}
