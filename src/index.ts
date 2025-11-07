import { makeTownsBot } from "@towns-protocol/bot";
import { Hono } from "hono";
import { logger } from "hono/logger";
import commands from "./commands";
import crypto from "node:crypto";
import { handleGhIssue } from "./handlers/gh-issue-handler";
import { handleGhPr } from "./handlers/gh-pr-handler";
import { handleGhPrs } from "./handlers/gh-prs-handler";
import { handleGhIssues } from "./handlers/gh-issues-handler";
import { handleGithubSubscription } from "./handlers/github-subscription-handler";
import {
  formatPullRequest,
  formatIssue,
  formatPush,
  formatRelease,
  formatWorkflowRun,
  formatIssueComment,
  formatPullRequestReview,
} from "./formatters/github-events";

const bot = await makeTownsBot(
  process.env.APP_PRIVATE_DATA!,
  process.env.JWT_SECRET!,
  {
    commands,
  }
);

// ============================================================================
// STORAGE - In-memory maps (use SQLite for production)
// ============================================================================

const channelToRepos = new Map<string, Set<string>>(); // channelId -> Set of "owner/repo"
const repoToChannels = new Map<string, Set<string>>(); // "owner/repo" -> Set of channelIds

// ============================================================================
// SLASH COMMAND HANDLERS
// ============================================================================

bot.onSlashCommand("help", async (handler, { channelId }) => {
  await handler.sendMessage(
    channelId,
    "**GitHub Bot for Towns**\n\n" +
      "**Subscription Commands:**\n" +
      "• `/github subscribe owner/repo` - Subscribe to GitHub events\n" +
      "• `/github unsubscribe` - Unsubscribe from all repos\n" +
      "• `/github status` - Show current subscriptions\n\n" +
      "**Query Commands:**\n" +
      "• `/gh_pr owner/repo #123 [--full]` - Show pull request details\n" +
      "• `/gh_issue owner/repo #123 [--full]` - Show issue details\n" +
      "• `/gh_prs owner/repo [count]` - List recent pull requests (default: 10, max: 50)\n" +
      "• `/gh_issues owner/repo [count]` - List recent issues (default: 10, max: 50)\n" +
      "• Add `--full` flag to show complete description\n\n" +
      "**Other Commands:**\n" +
      "• `/help` - Show this help message"
  );
});

bot.onSlashCommand("github", async (handler, event) => {
  await handleGithubSubscription(handler, event, {
    channelToRepos,
    repoToChannels,
  });
});

bot.onSlashCommand("gh_pr", handleGhPr);

bot.onSlashCommand("gh_issue", handleGhIssue);

bot.onSlashCommand("gh_prs", handleGhPrs);

bot.onSlashCommand("gh_issues", handleGhIssues);

// ============================================================================
// START BOT & SETUP HONO APP
// ============================================================================

const { jwtMiddleware, handler } = bot.start();

const app = new Hono();
app.use(logger());

// Towns webhook endpoint
app.post("/webhook", jwtMiddleware, handler);

// GitHub webhook endpoint
app.post("/github-webhook", async c => {
  const signature = c.req.header("X-Hub-Signature-256");
  const event = c.req.header("X-GitHub-Event");
  const body = await c.req.text();

  // Verify webhook signature if secret is configured
  const webhookSecret = process.env.GITHUB_WEBHOOK_SECRET;
  if (webhookSecret && signature) {
    const hmac = crypto.createHmac("sha256", webhookSecret);
    hmac.update(body);
    const digest = `sha256=${hmac.digest("hex")}`;

    if (signature !== digest) {
      return c.json({ error: "Invalid signature" }, 401);
    }
  }

  const payload = JSON.parse(body);
  const repo = payload.repository?.full_name;

  if (!repo) {
    return c.json({ ok: true, message: "no repository in payload" });
  }

  // Find subscribed channels
  const channels = repoToChannels.get(repo);
  if (!channels || channels.size === 0) {
    return c.json({ ok: true, message: "no subscriptions for this repo" });
  }

  // Format message based on event type
  let message = "";
  switch (event) {
    case "pull_request":
      message = formatPullRequest(payload);
      break;
    case "issues":
      message = formatIssue(payload);
      break;
    case "push":
      message = formatPush(payload);
      break;
    case "release":
      message = formatRelease(payload);
      break;
    case "workflow_run":
      message = formatWorkflowRun(payload);
      break;
    case "issue_comment":
      message = formatIssueComment(payload);
      break;
    case "pull_request_review":
      message = formatPullRequestReview(payload);
      break;
  }

  // Send to all subscribed channels
  if (message) {
    for (const channelId of channels) {
      try {
        await bot.sendMessage(channelId, message);
      } catch (error) {
        console.error(`Failed to send to channel ${channelId}:`, error);
      }
    }
  }

  return c.json({ ok: true, event, repo, channels: channels.size });
});

// Health check endpoint
app.get("/health", c => {
  return c.json({
    status: "ok",
    subscriptions: channelToRepos.size,
    repos: repoToChannels.size,
  });
});

export default app;
