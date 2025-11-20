import { makeTownsBot } from "@towns-protocol/bot";
import { Hono } from "hono";
import { logger } from "hono/logger";
import commands from "./commands";
import { handleGhIssue } from "./handlers/gh-issue-handler";
import { handleGhPr } from "./handlers/gh-pr-handler";
import { handleGithubSubscription } from "./handlers/github-subscription-handler";
import { pollingService } from "./services/polling-service";
import { db, dbService, dbReady } from "./db";
import { githubInstallations } from "./db/schema";
import { GitHubApp } from "./github-app/app";
import { WebhookProcessor } from "./github-app/webhook-processor";
import { InstallationService } from "./github-app/installation-service";
import { EventProcessor } from "./github-app/event-processor";
import { handleGitHubWebhook } from "./routes/github-webhook";

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
const installationService = new InstallationService(bot);
const eventProcessor = new EventProcessor(bot);

// Register webhook event handlers (only if GitHub App is configured)
if (githubApp.isEnabled()) {
  githubApp.webhooks.on("installation", async ({ payload }) => {
    if (payload.action === "created") {
      await installationService.handleInstallationCreated(payload);
    } else if (payload.action === "deleted") {
      await installationService.handleInstallationDeleted(payload);
    }
  });

  githubApp.webhooks.on("installation_repositories", async ({ payload }) => {
    if (payload.action === "added") {
      await installationService.handleRepositoriesAdded(payload);
    } else if (payload.action === "removed") {
      await installationService.handleRepositoriesRemoved(payload);
    }
  });

  githubApp.webhooks.on("pull_request", async ({ payload }) => {
    await eventProcessor.processPullRequest(payload);
  });

  githubApp.webhooks.on("push", async ({ payload }) => {
    await eventProcessor.processPush(payload);
  });

  githubApp.webhooks.on("issues", async ({ payload }) => {
    await eventProcessor.processIssues(payload);
  });

  githubApp.webhooks.on("release", async ({ payload }) => {
    await eventProcessor.processRelease(payload);
  });

  githubApp.webhooks.on("workflow_run", async ({ payload }) => {
    await eventProcessor.processWorkflowRun(payload);
  });

  githubApp.webhooks.on("issue_comment", async ({ payload }) => {
    await eventProcessor.processIssueComment(payload);
  });

  githubApp.webhooks.on("pull_request_review", async ({ payload }) => {
    await eventProcessor.processPullRequestReview(payload);
  });

  githubApp.webhooks.on("create", async ({ payload }) => {
    await eventProcessor.processBranchEvent(payload, "create");
  });

  githubApp.webhooks.on("delete", async ({ payload }) => {
    await eventProcessor.processBranchEvent(payload, "delete");
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
      "**Subscription Commands:**\n" +
      "• `/github subscribe owner/repo` - Subscribe to GitHub events (checked every 5 min)\n" +
      "• `/github unsubscribe owner/repo` - Unsubscribe from a repository\n" +
      "• `/github status` - Show current subscriptions\n\n" +
      "**Query Commands:**\n" +
      "• `/gh_pr owner/repo #123 [--full]` - Show single PR details\n" +
      "• `/gh_pr list owner/repo [count] [--state=...] [--author=...]` - List PRs\n" +
      "• `/gh_issue owner/repo #123 [--full]` - Show single issue details\n" +
      "• `/gh_issue list owner/repo [count] [--state=...] [--creator=...]` - List issues\n" +
      "• Filters: --state=open|closed|merged|all, --author/--creator=username\n\n" +
      "**Other Commands:**\n" +
      "• `/help` - Show this help message"
  );
});

bot.onSlashCommand("github", async (handler, event) => {
  await handleGithubSubscription(handler, event);
});

bot.onSlashCommand("gh_pr", handleGhPr);

bot.onSlashCommand("gh_issue", handleGhIssue);

// ============================================================================
// START BOT & SETUP HONO APP
// ============================================================================

const { jwtMiddleware, handler } = bot.start();

const app = new Hono();
app.use(logger());

// Towns webhook endpoint
app.post("/webhook", jwtMiddleware, handler);

// GitHub App webhook endpoint
app.post("/github-webhook", c =>
  handleGitHubWebhook(c, githubApp, webhookProcessor)
);

// Health check endpoint
app.get("/health", async c => {
  const repos = await dbService.getAllSubscribedRepos();

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

// Set the function used to send messages to Towns channels
pollingService.setSendMessageFunction(async (channelId, message) => {
  await bot.sendMessage(channelId, message);
});

// Set dual-mode check: skip polling if GitHub App installed
pollingService.setCheckIfRepoNeedsPolling(async (repo: string) => {
  if (!githubApp.isEnabled()) {
    return true; // No GitHub App, always poll
  }
  const installationId = await installationService.isRepoInstalled(repo);
  return installationId === null; // Poll only if NOT installed
});

// Start polling for GitHub events
pollingService.start();

console.log("✅ GitHub polling service started (5 minute intervals)");

export default app;
