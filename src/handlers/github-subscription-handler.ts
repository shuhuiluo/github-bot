import type { BotHandler } from "@towns-protocol/bot";
import { stripMarkdown } from "../utils/stripper";
import {
  ALLOWED_EVENT_TYPES,
  DEFAULT_EVENT_TYPES,
} from "../constants/event-types";
import type { SubscriptionService } from "../services/subscription-service";
import type { SlashCommandEvent } from "../types/bot";

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
  event: SlashCommandEvent,
  subscriptionService: SubscriptionService
): Promise<void> {
  const { channelId, spaceId, userId, args } = event;
  const [action, repoArg] = args;

  if (!action) {
    await handler.sendMessage(
      channelId,
      "**Usage:**\n" +
        "• `/github subscribe owner/repo [--events pr,issues,commits,releases,ci,comments,reviews,branches,review_comments,stars,forks,all]` - Subscribe to GitHub events\n" +
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
          "❌ Usage: `/github subscribe owner/repo [--events pr,issues,commits,releases,ci,comments,reviews,branches,review_comments,stars,forks,all]`"
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

      // Use SubscriptionService for OAuth-first subscription flow
      const result = await subscriptionService.subscribeToRepository({
        townsUserId: userId,
        spaceId,
        channelId,
        repoIdentifier: repo,
        eventTypes,
      });

      // Handle OAuth requirement
      if (result.requiresOAuth && result.authUrl) {
        await handler.sendMessage(
          channelId,
          `🔐 **GitHub Account Required**\n\n` +
            `To subscribe to repositories, you need to connect your GitHub account.\n\n` +
            `[Connect GitHub Account](${result.authUrl})`
        );
        return;
      }

      // Handle installation requirement (private repos)
      if (result.requiresInstallation && result.installUrl) {
        await handler.sendMessage(
          channelId,
          `🔒 **GitHub App Installation Required**\n\n` +
            `This private repository requires the GitHub App to be installed.\n\n` +
            `${result.error || "Install the app to subscribe to this repository."}\n\n` +
            `[Install GitHub App](${result.installUrl})`
        );
        return;
      }

      // Handle error
      if (!result.success) {
        await handler.sendMessage(
          channelId,
          `❌ ${result.error || "Subscription failed"}`
        );
        return;
      }

      // Success - format response
      const eventTypeDisplay = formatEventTypes(eventTypes);
      let deliveryInfo = "";

      if (result.deliveryMode === "webhook") {
        deliveryInfo = "⚡ Real-time webhook delivery enabled!";
      } else {
        deliveryInfo = "⏱️ Events are checked every 5 minutes (polling mode)";

        // Add installation suggestion for public repos
        if (result.suggestInstall && result.installUrl) {
          const adminHint = result.isAdmin
            ? "You can install the GitHub App for real-time delivery:"
            : "Ask an admin to install the GitHub App for real-time delivery:";
          deliveryInfo +=
            `\n\n💡 **Want real-time notifications?** ${adminHint}\n` +
            `   [Install GitHub App](${result.installUrl})`;
        }
      }

      await handler.sendMessage(
        channelId,
        `✅ **Subscribed to ${result.repoFullName}**\n\n` +
          `📡 Event types: **${eventTypeDisplay}**\n` +
          `${deliveryInfo}\n\n` +
          `🔗 https://github.com/${result.repoFullName}`
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
      const channelRepos = await subscriptionService.getChannelSubscriptions(
        channelId,
        spaceId
      );
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
      const success = await subscriptionService.unsubscribe(
        channelId,
        spaceId,
        repo
      );

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
      const subscriptions = await subscriptionService.getChannelSubscriptions(
        channelId,
        spaceId
      );
      if (subscriptions.length === 0) {
        await handler.sendMessage(
          channelId,
          "📭 **No subscriptions**\n\nUse `/github subscribe owner/repo` to get started"
        );
        return;
      }

      const repoList = subscriptions
        .map(sub => {
          const mode = sub.deliveryMode === "webhook" ? "⚡" : "⏱️";
          return `${mode} ${sub.repo} (${formatEventTypes(sub.eventTypes)})`;
        })
        .join("\n");

      await handler.sendMessage(
        channelId,
        `📬 **Subscribed Repositories (${subscriptions.length}):**\n\n${repoList}\n\n` +
          `⚡ Real-time  ⏱️ Polling (5 min)`
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
