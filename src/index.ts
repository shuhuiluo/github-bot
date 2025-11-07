import { makeTownsBot } from "@towns-protocol/bot";
import { Hono } from "hono";
import { logger } from "hono/logger";
import commands from "./commands";
import crypto from "node:crypto";
import { handleGhIssue } from "./handlers/gh-issue-handler";
import { handleGhPr } from "./handlers/gh-pr-handler";
import { githubFetch, validateRepo } from "./api/github-client";
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
      "• Add `--full` flag to show complete description\n\n" +
      "**Other Commands:**\n" +
      "• `/help` - Show this help message\n" +
      "• `/time` - Get the current time"
  );
});

bot.onSlashCommand("time", async (handler, { channelId }) => {
  const currentTime = new Date().toLocaleString();
  await handler.sendMessage(channelId, `Current time: ${currentTime} ⏰`);
});

bot.onSlashCommand("github", async (handler, event) => {
  const { channelId, args } = event;
  const [action, repo] = args;

  if (!action) {
    await handler.sendMessage(
      channelId,
      "**Usage:**\n" +
        "• `/github subscribe owner/repo`\n" +
        "• `/github unsubscribe`\n" +
        "• `/github status`"
    );
    return;
  }

  switch (action.toLowerCase()) {
    case "subscribe": {
      if (!repo) {
        await handler.sendMessage(
          channelId,
          "❌ Usage: `/github subscribe owner/repo`"
        );
        return;
      }

      // Validate repo format
      if (!repo.includes("/") || repo.split("/").length !== 2) {
        await handler.sendMessage(
          channelId,
          "❌ Invalid format. Use: `owner/repo` (e.g., `facebook/react`)"
        );
        return;
      }

      // Validate repo exists
      const isValid = await validateRepo(repo);
      if (!isValid) {
        await handler.sendMessage(
          channelId,
          `❌ Repository **${repo}** not found or is not public`
        );
        return;
      }

      // Store subscription
      if (!channelToRepos.has(channelId)) {
        channelToRepos.set(channelId, new Set());
      }
      channelToRepos.get(channelId)!.add(repo);

      if (!repoToChannels.has(repo)) {
        repoToChannels.set(repo, new Set());
      }
      repoToChannels.get(repo)!.add(channelId);

      await handler.sendMessage(
        channelId,
        `✅ **Subscribed to ${repo}**\n\n` +
          `**Next Steps:**\n` +
          `1. Go to https://github.com/${repo}/settings/hooks/new\n` +
          `2. Payload URL: \`${process.env.PUBLIC_URL || "https://your-bot.onrender.com"}/github-webhook\`\n` +
          `3. Content type: \`application/json\`\n` +
          `4. Secret: (set GITHUB_WEBHOOK_SECRET in your bot)\n` +
          `5. Events: Choose individual events or "Send me everything"\n` +
          `6. Click "Add webhook"\n\n` +
          `_Note: You need write access to the repository to add webhooks._`
      );
      break;
    }

    case "unsubscribe": {
      const repos = channelToRepos.get(channelId);
      if (!repos || repos.size === 0) {
        await handler.sendMessage(
          channelId,
          "❌ This channel has no subscriptions"
        );
        return;
      }

      // Remove from reverse mapping
      for (const repoName of repos) {
        const channels = repoToChannels.get(repoName);
        if (channels) {
          channels.delete(channelId);
          if (channels.size === 0) {
            repoToChannels.delete(repoName);
          }
        }
      }

      // Remove channel subscriptions
      channelToRepos.delete(channelId);

      await handler.sendMessage(
        channelId,
        "✅ Unsubscribed from all repositories"
      );
      break;
    }

    case "status": {
      const repos = channelToRepos.get(channelId);
      if (!repos || repos.size === 0) {
        await handler.sendMessage(
          channelId,
          "📭 **No subscriptions**\n\nUse `/github subscribe owner/repo` to get started"
        );
        return;
      }

      const repoList = Array.from(repos)
        .map(r => `• ${r}`)
        .join("\n");

      await handler.sendMessage(
        channelId,
        `📬 **Subscribed Repositories:**\n\n${repoList}`
      );
      break;
    }

    default:
      await handler.sendMessage(
        channelId,
        `❌ Unknown action: \`${action}\`\n\n` +
          "**Available actions:**\n" +
          "• `subscribe`\n" +
          "• `unsubscribe`\n" +
          "• `status`"
      );
  }
});

bot.onSlashCommand("gh_pr", handleGhPr);

bot.onSlashCommand("gh_issue", handleGhIssue);

// ============================================================================
// MESSAGE HANDLER - Auto-unfurl GitHub URLs (bonus feature)
// ============================================================================
bot.onMessage(async (handler, { message, channelId }) => {
  // Detect GitHub URLs
  const githubUrlRegex =
    /https:\/\/github\.com\/([^\/]+)\/([^\/\s]+)\/(pull|issues)\/(\d+)/g;
  const matches = [...message.matchAll(githubUrlRegex)];

  if (matches.length > 0) {
    for (const match of matches.slice(0, 2)) {
      // Limit to 2 unfurls per message
      const [, owner, repo, type, number] = match;

      try {
        const endpoint = type === "pull" ? "pulls" : "issues";
        const data = await githubFetch(
          `/repos/${owner}/${repo}/${endpoint}/${number}`
        );

        const unfurled =
          `**${type === "pull" ? "PR" : "Issue"} #${data.number}** in ${owner}/${repo}\n` +
          `**${data.title}**\n` +
          `👤 ${data.user.login} | ${data.state === "open" ? "🟢 Open" : "✅ Closed"}`;

        await handler.sendMessage(channelId, unfurled);
      } catch {
        // Silently ignore unfurl errors
      }
    }
  }
});

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
