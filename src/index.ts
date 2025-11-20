import { Hono } from "hono";
import { logger } from "hono/logger";
import { makeTownsBot } from "@towns-protocol/bot";

import commands from "./commands";
import { db, dbReady } from "./db";
import { githubInstallations } from "./db/schema";
import { GitHubApp } from "./github-app/app";
import { EventProcessor } from "./github-app/event-processor";
import { InstallationService } from "./github-app/installation-service";
import { WebhookProcessor } from "./github-app/webhook-processor";
import { handleGhIssue } from "./handlers/gh-issue-handler";
import { handleGhPr } from "./handlers/gh-pr-handler";
import { handleGithubSubscription } from "./handlers/github-subscription-handler";
import { handleGitHubWebhook } from "./routes/github-webhook";
import { handleOAuthCallback } from "./routes/oauth-callback";
import { GitHubOAuthService } from "./services/github-oauth-service";
import { OAuthCleanupService } from "./services/oauth-cleanup-service";
import { PollingService } from "./services/polling-service";
import { SubscriptionService } from "./services/subscription-service";
import { UserOAuthClient } from "./services/user-oauth-client";

await dbReady;
console.log("✅ Database ready (schema ensured)");

const bot = await makeTownsBot(
  process.env.APP_PRIVATE_DATA!,
  process.env.JWT_SECRET!,
  {
    commands,
  }
);

// ============================================================================
// GITHUB APP INITIALIZATION
// ============================================================================

const githubApp = new GitHubApp();
const webhookProcessor = new WebhookProcessor();
const installationService = new InstallationService(githubApp);
const oauthService = new GitHubOAuthService(githubApp);
const oauthCleanupService = new OAuthCleanupService();

// Subscription services
const userOAuthClient = new UserOAuthClient();
const subscriptionService = new SubscriptionService(
  oauthService,
  userOAuthClient,
  installationService
);

// Enable automatic subscription upgrades when repos are added to GitHub App
installationService.setSubscriptionService(subscriptionService);

// Event processing service
const eventProcessor = new EventProcessor(bot, subscriptionService);

// Polling service (5 minute intervals)
const pollingService = new PollingService(
  bot,
  subscriptionService,
  5 * 60 * 1000
);

// Register webhook event handlers (only if GitHub App is configured)
if (githubApp.isEnabled()) {
  githubApp.webhooks.on("installation", async ({ payload }) => {
    if (payload.action === "created") {
      await installationService.onInstallationCreated(payload);
    } else if (payload.action === "deleted") {
      await installationService.onInstallationDeleted(payload);
    }
  });

  githubApp.webhooks.on("installation_repositories", async ({ payload }) => {
    if (payload.action === "added") {
      await installationService.onRepositoriesAdded(payload);
    } else if (payload.action === "removed") {
      await installationService.onRepositoriesRemoved(payload);
    }
  });

  githubApp.webhooks.on("pull_request", async ({ payload }) => {
    await eventProcessor.onPullRequest(payload);
  });

  githubApp.webhooks.on("push", async ({ payload }) => {
    await eventProcessor.onPush(payload);
  });

  githubApp.webhooks.on("issues", async ({ payload }) => {
    await eventProcessor.onIssues(payload);
  });

  githubApp.webhooks.on("release", async ({ payload }) => {
    await eventProcessor.onRelease(payload);
  });

  githubApp.webhooks.on("workflow_run", async ({ payload }) => {
    await eventProcessor.onWorkflowRun(payload);
  });

  githubApp.webhooks.on("issue_comment", async ({ payload }) => {
    await eventProcessor.onIssueComment(payload);
  });

  githubApp.webhooks.on("pull_request_review", async ({ payload }) => {
    await eventProcessor.onPullRequestReview(payload);
  });

  githubApp.webhooks.on("create", async ({ payload }) => {
    await eventProcessor.onBranchEvent(payload, "create");
  });

  githubApp.webhooks.on("delete", async ({ payload }) => {
    await eventProcessor.onBranchEvent(payload, "delete");
  });

  githubApp.webhooks.on("fork", async ({ payload }) => {
    await eventProcessor.onFork(payload);
  });

  githubApp.webhooks.on("watch", async ({ payload }) => {
    await eventProcessor.onWatch(payload);
  });

  console.log("✅ GitHub App webhooks registered");
} else {
  console.log("⚠️  GitHub App not configured - running in polling-only mode");
}

// ============================================================================
// SLASH COMMAND HANDLERS
// ============================================================================

bot.onSlashCommand("help", async (handler, { channelId }) => {
  await handler.sendMessage(
    channelId,
    "**GitHub Bot for Towns**\n\n" +
      "**Subscriptions**\n" +
      "• `/github subscribe owner/repo [--events=pr,issues,...]`\n" +
      "• `/github unsubscribe owner/repo`\n" +
      "• `/github status`\n\n" +
      "**Events:** pr, issues, commits, releases, ci, comments, reviews, branches, forks, stars\n\n" +
      "**Queries** _(public repos)_\n" +
      "• `/gh_pr owner/repo #123 [--full]`\n" +
      "• `/gh_pr list owner/repo [count] [--state=...] [--author=...]`\n" +
      "• `/gh_issue owner/repo #123 [--full]`\n" +
      "• `/gh_issue list owner/repo [count] [--state=...] [--creator=...]`\n\n" +
      "_Private repos require OAuth + GitHub App_"
  );
});

bot.onSlashCommand("github", async (handler, event) => {
  await handleGithubSubscription(handler, event, subscriptionService);
});

bot.onSlashCommand("gh_pr", async (handler, event) => {
  await handleGhPr(handler, event, oauthService);
});

bot.onSlashCommand("gh_issue", async (handler, event) => {
  await handleGhIssue(handler, event, oauthService);
});

// ============================================================================
// START BOT & SETUP HONO APP
// ============================================================================

const { jwtMiddleware, handler } = bot.start();

const app = new Hono();
app.use(logger());

// Towns webhook endpoint
app.post("/webhook", jwtMiddleware, handler);

// Agent metadata endpoint
app.get("/.well-known/agent-metadata.json", async c => {
  return c.json(await bot.getIdentityMetadata());
});

// OAuth callback endpoint
app.get("/oauth/callback", c =>
  handleOAuthCallback(c, oauthService, subscriptionService, bot)
);

// GitHub App webhook endpoint
// IMPORTANT: Do not use body parsing middleware before this endpoint
app.post("/github-webhook", c =>
  handleGitHubWebhook(c, githubApp, webhookProcessor)
);

// Health check endpoint
app.get("/health", async c => {
  const repos = await subscriptionService.getAllSubscribedRepos();

  // Get GitHub App installation count if enabled
  let installationCount = 0;
  if (githubApp.isEnabled()) {
    const installations = await db.select().from(githubInstallations);
    installationCount = installations.length;
  }

  return c.json({
    status: "ok",
    subscribed_repos: repos.length,
    polling_active: true,
    github_app: {
      configured: githubApp.isEnabled(),
      installations: installationCount,
    },
  });
});

// ============================================================================
// START POLLING SERVICE
// ============================================================================

// Start polling for GitHub events
pollingService.start();

console.log("✅ GitHub polling service started (5 minute intervals)");

// ============================================================================
// START OAUTH CLEANUP SERVICE
// ============================================================================

// Start periodic cleanup of expired OAuth states (every hour)
oauthCleanupService.startPeriodicCleanup();

console.log("✅ OAuth cleanup service started (hourly cleanup)");

export default app;
