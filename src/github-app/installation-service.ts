import { and, eq } from "drizzle-orm";

import { db } from "../db";
import { githubInstallations, installationRepositories } from "../db/schema";
import type { SubscriptionService } from "../services/subscription-service";
import type {
  InstallationPayload,
  InstallationRepositoriesPayload,
} from "../types/webhooks";
import type { GitHubApp } from "./app";

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

    // Store repositories in normalized table
    if (repositories) {
      for (const repo of repositories) {
        if (!repo.full_name) continue;
        await db.insert(installationRepositories).values({
          installationId: installation.id,
          repoFullName: repo.full_name,
          addedAt: new Date(),
        });
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

    // Remove installation (foreign key CASCADE automatically deletes related repositories)
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

      // Add repository to installation
      await db
        .insert(installationRepositories)
        .values({
          installationId: installation.id,
          repoFullName: repo.full_name,
          addedAt: new Date(),
        })
        .onConflictDoNothing();

      // Upgrade existing polling subscriptions to webhook mode
      if (this.subscriptionService) {
        try {
          const upgraded = await this.subscriptionService.upgradeToWebhook(
            repo.full_name,
            installation.id
          );
          if (upgraded > 0) {
            console.log(
              `Upgraded ${upgraded} subscription(s) for ${repo.full_name} to webhook delivery`
            );
          }
        } catch (error) {
          console.error(
            `Failed to upgrade subscriptions for ${repo.full_name} (installation ${installation.id}):`,
            error
          );
          // Continue processing other repos
        }
      }
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
   * Check if a repository has GitHub App installed
   * Returns installation ID if installed, null otherwise
   */
  async isRepoInstalled(repo: string): Promise<number | null> {
    try {
      const installation = await db
        .select()
        .from(installationRepositories)
        .where(eq(installationRepositories.repoFullName, repo))
        .limit(1);

      return installation[0]?.installationId ?? null;
    } catch (error) {
      console.warn(
        `[InstallationService] Failed to check repo installation for ${repo}:`,
        error
      );
      return null;
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
