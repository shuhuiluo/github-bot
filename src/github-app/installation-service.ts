import { and, eq } from "drizzle-orm";
import type { BotHandler } from "@towns-protocol/bot";

import { getOwnerIdFromUsername, parseRepo } from "../api/github-client";
import { db } from "../db";
import { githubInstallations, installationRepositories } from "../db/schema";
import type { SubscriptionService } from "../services/subscription-service";
import type {
  InstallationPayload,
  InstallationRepositoriesPayload,
} from "../types/webhooks";
import type { GitHubApp } from "./app";

/**
 * Generate GitHub App installation URL
 * @param targetId - Owner ID (user or org), optional
 */
export function generateInstallUrl(targetId?: number): string {
  const appSlug = process.env.GITHUB_APP_SLUG || "towns-github-bot";
  const baseUrl = `https://github.com/apps/${appSlug}/installations/new`;
  return targetId ? `${baseUrl}/permissions?target_id=${targetId}` : baseUrl;
}

/**
 * Send GitHub App installation prompt when user has OAuth but no repo access
 */
export async function sendInstallPrompt(
  handler: BotHandler,
  channelId: string,
  repoFullName: string
): Promise<void> {
  const [owner] = parseRepo(repoFullName);
  const ownerId = await getOwnerIdFromUsername(owner);
  const installUrl = generateInstallUrl(ownerId);
  await handler.sendMessage(
    channelId,
    `❌ Cannot access this repository\n\n` +
      `Private repositories require the GitHub App to be installed:\n` +
      `[Install GitHub App](${installUrl})`
  );
}

/**
 * InstallationService - Manages GitHub App installation lifecycle
 *
 * Handles installation created/deleted events and repository changes.
 * Stores installation data in normalized tables (no JSON columns).
 * Does not send notifications - behavior changes are transparent to users.
 */
export class InstallationService {
  private githubApp: GitHubApp;
  private subscriptionService?: SubscriptionService;

  constructor(githubApp: GitHubApp) {
    this.githubApp = githubApp;
  }

  /**
   * Set subscription service (called after both services are initialized)
   * Enables automatic subscription upgrades when repos are added to installation
   */
  setSubscriptionService(subscriptionService: SubscriptionService): void {
    this.subscriptionService = subscriptionService;
  }

  /**
   * Handle GitHub App installation created event
   */
  async onInstallationCreated(event: InstallationPayload) {
    const { installation, repositories } = event;

    // Get account info with proper type checking
    const account = installation.account;
    const accountLogin =
      (account && "login" in account ? account.login : account?.name) ??
      "unknown";
    const accountType =
      (account && "type" in account ? account.type : undefined) ??
      "Organization";

    console.log(`GitHub App installed: ${accountLogin} (${installation.id})`);

    // Store installation in database
    await this.insertInstallation(installation, accountLogin, accountType);

    // Store repositories in normalized table and upgrade subscriptions
    if (repositories) {
      for (const repo of repositories) {
        if (!repo.full_name) continue;
        await this.addRepoAndUpgrade(repo.full_name, installation.id);
      }
    }
  }

  /**
   * Handle GitHub App installation deleted event
   */
  async onInstallationDeleted(event: InstallationPayload) {
    const { installation } = event;

    // Get account info with proper type checking
    const account = installation.account;
    const accountLogin =
      (account && "login" in account ? account.login : account?.name) ??
      "unknown";

    console.log(`GitHub App uninstalled: ${accountLogin} (${installation.id})`);

    // Downgrade subscriptions before deleting installation
    await this.handleDowngrade(installation.id);

    // Remove installation (foreign key CASCADE automatically deletes related repositories)
    // Note: This will also SET NULL on githubSubscriptions.installationId via foreign key
    await db
      .delete(githubInstallations)
      .where(eq(githubInstallations.installationId, installation.id));
  }

  /**
   * Handle repositories added to installation
   */
  async onRepositoriesAdded(event: InstallationRepositoriesPayload) {
    const { installation, repositories_added } = event;

    console.log(
      `Repositories added to installation ${installation.id}: ${repositories_added.map(r => r.full_name || "unknown").join(", ")}`
    );

    // Ensure installation record exists (handles webhook ordering issues)
    await this.ensureInstallationExists(installation.id);

    // Add new repositories to normalized table and upgrade subscriptions
    for (const repo of repositories_added) {
      if (!repo.full_name) continue;
      await this.addRepoAndUpgrade(repo.full_name, installation.id);
    }
  }

  /**
   * Handle repositories removed from installation
   */
  async onRepositoriesRemoved(event: InstallationRepositoriesPayload) {
    const { installation, repositories_removed } = event;

    console.log(
      `Repositories removed from installation ${installation.id}: ${repositories_removed.map(r => r.full_name || "unknown").join(", ")}`
    );

    // Downgrade subscriptions before deleting installation repos
    const repoNames = repositories_removed
      .map(r => r.full_name)
      .filter((name): name is string => Boolean(name));

    await this.handleDowngrade(installation.id, repoNames);

    // Remove repositories from normalized table
    for (const repo of repositories_removed) {
      if (!repo.full_name) continue;
      await db
        .delete(installationRepositories)
        .where(
          and(
            eq(installationRepositories.installationId, installation.id),
            eq(installationRepositories.repoFullName, repo.full_name)
          )
        );
    }
  }

  /**
   * Helper to downgrade subscriptions and log results
   */
  private async handleDowngrade(
    installationId: number,
    repos?: string[]
  ): Promise<void> {
    if (!this.subscriptionService) return;

    try {
      const { downgraded, removed } =
        await this.subscriptionService.downgradeSubscriptions(
          installationId,
          repos
        );

      if (downgraded > 0) {
        console.log(
          `Downgraded ${downgraded} subscription(s) from webhook to polling mode`
        );
      }

      if (removed > 0) {
        console.log(
          `Removed ${removed} private repo subscription(s) (requires app installation)`
        );
      }
    } catch (error) {
      console.error(
        `Failed to downgrade subscriptions for installation ${installationId}:`,
        error
      );
    }
  }

  /**
   * Check if a repository has GitHub App installed
   * Returns installation ID if installed, null otherwise
   */
  async isRepoInstalled(repo: string): Promise<number | null> {
    try {
      // First check DB (fast path)
      const installation = await db
        .select()
        .from(installationRepositories)
        .where(eq(installationRepositories.repoFullName, repo))
        .limit(1);

      if (installation[0]?.installationId) {
        return installation[0].installationId;
      }

      // DB miss - check GitHub API as fallback (handles DB out-of-sync scenarios)
      // Validate and parse repo string (must be exactly "owner/repo" format)
      const normalized = repo.trim();
      const parts = normalized.split("/");

      if (parts.length !== 2 || !parts[0] || !parts[1]) {
        console.warn(
          `[InstallationService] Invalid repo format: "${repo}" (expected "owner/repo")`
        );
        return null;
      }

      const [owner, repoName] = parts;
      return await this.checkRepoInstallationFromAPI(owner, repoName);
    } catch (error) {
      console.warn(
        `[InstallationService] Failed to check repo installation for ${repo}:`,
        error
      );
      return null;
    }
  }

  /**
   * Check GitHub API for repository installation (fallback when DB is out of sync)
   * Syncs installation data to DB if found
   */
  private async checkRepoInstallationFromAPI(
    owner: string,
    repo: string
  ): Promise<number | null> {
    try {
      if (!this.githubApp.isEnabled()) {
        return null;
      }

      const octokit = this.githubApp.getAppOctokit();
      const { data } = await octokit.request(
        "GET /repos/{owner}/{repo}/installation",
        { owner, repo }
      );

      // Sync installation data to DB for future lookups
      await this.ensureInstallationExists(data.id);

      // Add repo to installation_repositories table and upgrade any polling subscriptions
      const fullName = `${owner}/${repo}`;
      await this.addRepoAndUpgrade(fullName, data.id);

      return data.id;
    } catch (error) {
      // 404 = app not installed on this repo
      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
      if ((error as any)?.status === 404) {
        return null;
      }
      // Other errors (rate limit, network issues) - log and return null
      console.warn(`Error checking installation for ${owner}/${repo}:`, error);
      return null;
    }
  }

  /**
   * Add a repository to installation and upgrade any polling subscriptions
   */
  private async addRepoAndUpgrade(
    repoFullName: string,
    installationId: number
  ): Promise<void> {
    await db
      .insert(installationRepositories)
      .values({
        installationId,
        repoFullName,
        addedAt: new Date(),
      })
      .onConflictDoNothing();

    if (!this.subscriptionService) return;

    try {
      // Upgrade existing polling subscriptions to webhook
      const upgraded = await this.subscriptionService.upgradeToWebhook(
        repoFullName,
        installationId
      );
      if (upgraded > 0) {
        console.log(
          `Upgraded ${upgraded} subscription(s) for ${repoFullName} to webhook delivery`
        );
      }

      // Complete pending subscriptions that were waiting for installation
      const completed =
        await this.subscriptionService.completePendingSubscriptions(
          repoFullName
        );
      if (completed > 0) {
        console.log(
          `Completed ${completed} pending subscription(s) for ${repoFullName}`
        );
      }
    } catch (error) {
      console.error(
        `Failed to upgrade subscriptions for ${repoFullName}:`,
        error
      );
    }
  }

  /**
   * Insert installation record into database
   * Handles both webhook and API-fetched installation data
   */
  private async insertInstallation(
    installation: InstallationPayload["installation"],
    accountLogin: string,
    accountType: string
  ): Promise<void> {
    await db
      .insert(githubInstallations)
      .values({
        installationId: installation.id,
        accountLogin,
        accountType,
        installedAt: installation.created_at
          ? new Date(installation.created_at)
          : new Date(),
        suspendedAt: installation.suspended_at
          ? new Date(installation.suspended_at)
          : null,
        appSlug: installation.app_slug || "towns-github-bot",
      })
      .onConflictDoNothing();
  }

  /**
   * Ensure installation record exists in database
   * If missing, fetch from GitHub API and insert
   *
   * @param installationId - GitHub App installation ID
   */
  private async ensureInstallationExists(
    installationId: number
  ): Promise<void> {
    // Check if installation already exists
    const [existing] = await db
      .select()
      .from(githubInstallations)
      .where(eq(githubInstallations.installationId, installationId))
      .limit(1);

    if (existing) {
      return; // Already exists
    }

    // Installation missing - fetch from GitHub API
    console.log(
      `Installation ${installationId} not found in database, fetching from API...`
    );

    try {
      if (!this.githubApp.isEnabled()) {
        throw new Error("GitHub App not configured");
      }

      // Use app-authenticated Octokit (JWT) for app-level endpoint
      const octokit = this.githubApp.getAppOctokit();
      const { data: installation } = await octokit.request(
        "GET /app/installations/{installation_id}",
        { installation_id: installationId }
      );

      // Get account info with proper type checking
      const account = installation.account;
      const accountLogin =
        (account && "login" in account ? account.login : account?.name) ??
        "unknown";
      const accountType =
        (account && "type" in account ? account.type : undefined) ??
        "Organization";

      // Insert installation record
      await this.insertInstallation(installation, accountLogin, accountType);

      console.log(
        `Installation ${installationId} (${accountLogin}) synced from API`
      );
    } catch (error) {
      console.error(
        `Failed to fetch installation ${installationId} from API:`,
        error
      );
      throw error;
    }
  }
}
