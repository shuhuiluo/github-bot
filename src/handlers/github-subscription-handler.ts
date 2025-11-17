import type { BotHandler } from "@towns-protocol/bot";
import { validateRepo } from "../api/github-client";
import { stripMarkdown } from "../utils/stripper";
import { dbService } from "../db";
import {
  ALLOWED_EVENT_TYPES,
  DEFAULT_EVENT_TYPES,
} from "../constants/event-types";

interface GithubSubscriptionEvent {
  channelId: string;
  args: string[];
}

/**
 * Parse and validate event types from --events flag
 * Returns default types if no flag, or comma-separated validated event types
 * @throws Error if any event type is invalid
 */
function parseEventTypes(args: string[]): string {
  const eventsIndex = args.findIndex(arg => arg.startsWith("--events"));
  if (eventsIndex === -1) return DEFAULT_EVENT_TYPES;

  let rawEventTypes: string;

  // Check for --events=pr,issues format
  if (args[eventsIndex].includes("=")) {
    rawEventTypes = args[eventsIndex].split("=")[1] || DEFAULT_EVENT_TYPES;
  } else if (eventsIndex + 1 < args.length) {
    // Check for --events pr,issues format (next arg)
    rawEventTypes = args[eventsIndex + 1];
  } else {
    return DEFAULT_EVENT_TYPES;
  }

  // Parse and validate event types
  const tokens = rawEventTypes
    .split(",")
    .map(token => token.trim().toLowerCase())
    .filter(token => token.length > 0);

  // Handle "all" as special case
  if (tokens.includes("all")) {
    return ALLOWED_EVENT_TYPES.join(",");
  }

  // Validate each token
  const invalidTokens: string[] = [];
  const allowedSet = new Set(ALLOWED_EVENT_TYPES);
  for (const token of tokens) {
    if (!allowedSet.has(token as (typeof ALLOWED_EVENT_TYPES)[number])) {
      invalidTokens.push(token);
    }
  }

  if (invalidTokens.length > 0) {
    throw new Error(
      `Invalid event type(s): ${invalidTokens
        .map(t => `'${t}'`)
        .join(", ")}\n\n` +
        `Valid options: ${ALLOWED_EVENT_TYPES.join(", ")}, all`
    );
  }

  // Remove duplicates using Set and return
  const uniqueTokens = Array.from(new Set(tokens));
  return uniqueTokens.join(",");
}

/**
 * Format event types for display
 */
function formatEventTypes(eventTypes: string): string {
  return eventTypes
    .split(",")
    .map(t => t.trim())
    .join(", ");
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
        "• `/github subscribe owner/repo [--events pr,issues,commits,releases,ci,comments,reviews,all]` - Subscribe to GitHub events\n" +
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
          "❌ Usage: `/github subscribe owner/repo [--events pr,issues,commits,releases,ci,comments,reviews,all]`"
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

      // Parse and validate event types from args
      let eventTypes: string;
      try {
        eventTypes = parseEventTypes(args);
      } catch (error) {
        const errorMessage =
          error instanceof Error ? error.message : "Invalid event types";
        await handler.sendMessage(channelId, `❌ ${errorMessage}`);
        return;
      }

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
