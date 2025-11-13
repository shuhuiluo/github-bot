import type { BotHandler } from "@towns-protocol/bot";
import { validateRepo } from "../api/github-client";
import { stripMarkdown } from "../utils/stripper";
import { dbService } from "../db";

interface GithubSubscriptionEvent {
  channelId: string;
  args: string[];
}

/**
 * Parse event types from --events flag
 * Returns "all" if no flag, or comma-separated event types
 */
function parseEventTypes(args: string[]): string {
  const eventsIndex = args.findIndex(arg => arg.startsWith("--events"));
  if (eventsIndex === -1) return "all";

  // Check for --events=pr,issues format
  if (args[eventsIndex].includes("=")) {
    return args[eventsIndex].split("=")[1] || "all";
  }

  // Check for --events pr,issues format (next arg)
  if (eventsIndex + 1 < args.length) {
    return args[eventsIndex + 1];
  }

  return "all";
}

/**
 * Format event types for display
 */
function formatEventTypes(eventTypes: string): string {
  if (eventTypes === "all") return "all events";
  return eventTypes.split(",").map(t => t.trim()).join(", ");
}

export async function handleGithubSubscription(
  handler: BotHandler,
  event: GithubSubscriptionEvent
): Promise<void> {
  const { channelId, args } = event;
  const [action, repoArg] = args;

  if (!action) {
    await handler.sendMessage(
      channelId,
      "**Usage:**\n" +
        "• `/github subscribe owner/repo [--events pr,issues,commits,releases,ci,comments,reviews]` - Subscribe to GitHub events\n" +
        "• `/github unsubscribe owner/repo` - Unsubscribe from a repository\n" +
        "• `/github status` - Show current subscriptions"
    );
    return;
  }

  switch (action.toLowerCase()) {
    case "subscribe": {
      if (!repoArg) {
        await handler.sendMessage(
          channelId,
          "❌ Usage: `/github subscribe owner/repo [--events pr,issues,commits,releases,ci,comments,reviews]`"
        );
        return;
      }

      // Strip markdown formatting from repo name
      const repo = stripMarkdown(repoArg);

      // Validate repo format
      if (!repo.includes("/") || repo.split("/").length !== 2) {
        await handler.sendMessage(
          channelId,
          "❌ Invalid format. Use: `owner/repo` (e.g., `facebook/react`)"
        );
        return;
      }

      // Parse event types from args
      const eventTypes = parseEventTypes(args);

      // Check if already subscribed
      const isAlreadySubscribed = await dbService.isSubscribed(channelId, repo);
      if (isAlreadySubscribed) {
        await handler.sendMessage(
          channelId,
          `ℹ️ Already subscribed to **${repo}**`
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

      // Store subscription in database with event types
      await dbService.subscribe(channelId, repo, eventTypes);

      const eventTypeDisplay = formatEventTypes(eventTypes);
      await handler.sendMessage(
        channelId,
        `✅ **Subscribed to ${repo}**\n\n` +
          `📡 Event types: **${eventTypeDisplay}**\n\n` +
          `⏱️ Events are checked every 5 minutes.\n` +
          `🔗 ${`https://github.com/${repo}`}`
      );
      break;
    }

    case "unsubscribe": {
      if (!repoArg) {
        await handler.sendMessage(
          channelId,
          "❌ Usage: `/github unsubscribe owner/repo`"
        );
        return;
      }

      // Strip markdown formatting from repo name
      const repo = stripMarkdown(repoArg);

      // Validate repo format
      if (!repo.includes("/") || repo.split("/").length !== 2) {
        await handler.sendMessage(
          channelId,
          "❌ Invalid format. Use: `owner/repo` (e.g., `facebook/react`)"
        );
        return;
      }

      // Check if channel has any subscriptions
      const channelRepos = await dbService.getChannelSubscriptions(channelId);
      if (channelRepos.length === 0) {
        await handler.sendMessage(
          channelId,
          "❌ This channel has no subscriptions"
        );
        return;
      }

      // Check if subscribed to this specific repo
      if (!channelRepos.some(sub => sub.repo === repo)) {
        await handler.sendMessage(
          channelId,
          `❌ Not subscribed to **${repo}**\n\nUse \`/github status\` to see your subscriptions`
        );
        return;
      }

      // Remove subscription
      const success = await dbService.unsubscribe(channelId, repo);

      if (success) {
        await handler.sendMessage(
          channelId,
          `✅ **Unsubscribed from ${repo}**`
        );
      } else {
        await handler.sendMessage(
          channelId,
          `❌ Failed to unsubscribe from **${repo}**`
        );
      }
      break;
    }

    case "status": {
      const subscriptions = await dbService.getChannelSubscriptions(channelId);
      if (subscriptions.length === 0) {
        await handler.sendMessage(
          channelId,
          "📭 **No subscriptions**\n\nUse `/github subscribe owner/repo` to get started"
        );
        return;
      }

      const repoList = subscriptions
        .map(sub => `• ${sub.repo} (${formatEventTypes(sub.eventTypes)})`)
        .join("\n");

      await handler.sendMessage(
        channelId,
        `📬 **Subscribed Repositories (${subscriptions.length}):**\n\n${repoList}\n\n` +
          `⏱️ Checking for events every 5 minutes`
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
}
