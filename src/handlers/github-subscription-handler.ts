import type { BotHandler } from "@towns-protocol/bot";

import {
  ALLOWED_EVENT_TYPES,
  DEFAULT_EVENT_TYPES,
} from "../constants/event-types";
import type { GitHubOAuthService } from "../services/github-oauth-service";
import type { SubscriptionService } from "../services/subscription-service";
import type { SlashCommandEvent } from "../types/bot";
import { stripMarkdown } from "../utils/stripper";

export async function handleGithubSubscription(
  handler: BotHandler,
  event: SlashCommandEvent,
  subscriptionService: SubscriptionService,
  oauthService: GitHubOAuthService
): Promise<void> {
  const { channelId, args } = event;
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
    case "subscribe":
      await handleSubscribe(
        handler,
        event,
        subscriptionService,
        oauthService,
        repoArg
      );
      break;
    case "unsubscribe":
      await handleUnsubscribe(handler, event, subscriptionService, repoArg);
      break;
    case "status":
      await handleStatus(handler, event, subscriptionService);
      break;
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

/**
 * Handle subscribe action
 */
async function handleSubscribe(
  handler: BotHandler,
  event: SlashCommandEvent,
  subscriptionService: SubscriptionService,
  oauthService: GitHubOAuthService,
  repoArg: string | undefined
): Promise<void> {
  const { channelId, spaceId, userId, args } = event;

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

  // Check if user has linked their GitHub account
  const isLinked = await oauthService.isLinked(userId);
  if (!isLinked) {
    const authUrl = await oauthService.getAuthorizationUrl(
      userId,
      channelId,
      spaceId,
      "subscribe",
      { repo, eventTypes }
    );
    await handler.sendMessage(
      channelId,
      `🔐 **GitHub Account Required**\n\n` +
        `To subscribe to repositories, you need to connect your GitHub account.\n\n` +
        `[Connect GitHub Account](${authUrl})`
    );
    return;
  }

  // Create subscription (OAuth check already done)
  const result = await subscriptionService.createSubscription({
    townsUserId: userId,
    spaceId,
    channelId,
    repoIdentifier: repo,
    eventTypes,
  });

  // Handle installation requirement (private repos)
  if (!result.success && result.requiresInstallation) {
    await handler.sendMessage(
      channelId,
      `🔒 **GitHub App Installation Required**\n\n` +
        `This private repository requires the GitHub App to be installed.\n\n` +
        `${result.error}\n\n` +
        `[Install GitHub App](${result.installUrl})`
    );
    return;
  }

  // Handle other errors
  if (!result.success) {
    await handler.sendMessage(channelId, `❌ ${result.error}`);
    return;
  }

  // Success - format response
  const eventTypeDisplay = formatEventTypes(eventTypes);
  let deliveryInfo = "";

  if (result.deliveryMode === "webhook") {
    deliveryInfo = "⚡ Real-time webhook delivery enabled!";
  } else {
    // Add installation suggestion for public repos
    deliveryInfo =
      "⏱️ Events are checked every 5 minutes (polling mode)\n\n" +
      `💡 **Want real-time notifications?** Install the GitHub App:\n` +
      `   [Install GitHub App](${result.installUrl})`;
  }

  await handler.sendMessage(
    channelId,
    `✅ **Subscribed to [${result.repoFullName}](https://github.com/${result.repoFullName})**\n\n` +
      `📡 Event types: **${eventTypeDisplay}**\n\n` +
      `${deliveryInfo}`
  );
}

/**
 * Handle unsubscribe action
 */
async function handleUnsubscribe(
  handler: BotHandler,
  event: SlashCommandEvent,
  subscriptionService: SubscriptionService,
  repoArg: string | undefined
): Promise<void> {
  const { channelId, spaceId } = event;

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

  // Find matching subscription case-insensitively so users can type any casing
  const subscription = channelRepos.find(
    sub => sub.repo.toLowerCase() === repo.toLowerCase()
  );

  if (!subscription) {
    await handler.sendMessage(
      channelId,
      `❌ Not subscribed to **${repo}**\n\nUse \`/github status\` to see your subscriptions`
    );
    return;
  }

  // Remove subscription using canonical repo name from the DB
  const success = await subscriptionService.unsubscribe(
    channelId,
    spaceId,
    subscription.repo
  );

  if (success) {
    await handler.sendMessage(channelId, `✅ **Unsubscribed from ${repo}**`);
  } else {
    await handler.sendMessage(
      channelId,
      `❌ Failed to unsubscribe from **${repo}**`
    );
  }
}

/**
 * Handle status action
 */
async function handleStatus(
  handler: BotHandler,
  event: SlashCommandEvent,
  subscriptionService: SubscriptionService
): Promise<void> {
  const { channelId, spaceId } = event;

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
