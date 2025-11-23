import type { BotHandler } from "@towns-protocol/bot";

import { ALLOWED_EVENT_TYPES, DEFAULT_EVENT_TYPES } from "../constants";
import {
  TokenStatus,
  type GitHubOAuthService,
} from "../services/github-oauth-service";
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
        "• `/github subscribe owner/repo [--events pr,issues,commits,releases,ci,comments,reviews,branches,review_comments,stars,forks,all]` - Subscribe to GitHub events or add event types\n" +
        "• `/github unsubscribe owner/repo [--events type1,type2]` - Unsubscribe from a repository or remove specific event types\n" +
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

  const hasEventsFlag = args.some(arg => arg.startsWith("--events"));

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

  // Check if already subscribed - if so, add event types instead (case-insensitive match)
  const channelSubscriptions =
    await subscriptionService.getChannelSubscriptions(channelId, spaceId);
  const existingSubscription = channelSubscriptions.find(
    sub => sub.repo.toLowerCase() === repo.toLowerCase()
  );

  if (existingSubscription && hasEventsFlag) {
    // Add event types to existing subscription
    const addResult = await subscriptionService.addEventTypes(
      spaceId,
      channelId,
      existingSubscription.repo,
      eventTypes.split(",").map(t => t.trim())
    );

    if (!addResult.success) {
      await handler.sendMessage(channelId, `❌ ${addResult.error}`);
      return;
    }

    const mode = existingSubscription.deliveryMode === "webhook" ? "⚡" : "⏱️";
    await handler.sendMessage(
      channelId,
      `✅ **Updated subscription to ${repo}**\n\n` +
        `${mode} Event types: **${formatEventTypes(addResult.eventTypes!)}**`
    );
    return;
  }

  if (existingSubscription && !hasEventsFlag) {
    await handler.sendMessage(
      channelId,
      `❌ Already subscribed to **${existingSubscription.repo}**\n\n` +
        "Use `--events` to add specific event types, or `/github status` to view current settings."
    );
    return;
  }

  // Check if user has linked their GitHub account and token is valid
  const tokenStatus = await oauthService.validateToken(userId);

  if (tokenStatus !== TokenStatus.Valid) {
    const authUrl = await oauthService.getAuthorizationUrl(
      userId,
      channelId,
      spaceId,
      "subscribe",
      { repo, eventTypes }
    );

    switch (tokenStatus) {
      case TokenStatus.NotLinked:
        await handler.sendMessage(
          channelId,
          `🔐 **GitHub Account Required**\n\n` +
            `To subscribe to repositories, you need to connect your GitHub account.\n\n` +
            `[Connect GitHub Account](${authUrl})`
        );
        return;

      case TokenStatus.Invalid:
        await handler.sendMessage(
          channelId,
          `⚠️ **GitHub Token Expired**\n\n` +
            `Your GitHub token has expired or been revoked. Please reconnect your account.\n\n` +
            `[Reconnect GitHub Account](${authUrl})`
        );
        return;

      case TokenStatus.Unknown:
        await handler.sendMessage(
          channelId,
          `⚠️ **Unable to Verify GitHub Connection**\n\n` +
            `We couldn't verify your GitHub token. This could be temporary (rate limiting) or indicate a connection issue.\n\n` +
            `Please try again in a few moments, or [reconnect your account](${authUrl}) if the problem persists.`
        );
        return;

      default: {
        // TypeScript exhaustiveness check
        const _exhaustive: never = tokenStatus;
        return _exhaustive;
      }
    }
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
  const deliveryInfo =
    result.deliveryMode === "webhook"
      ? "⚡ Real-time webhook delivery enabled!"
      : "⏱️ Events are checked every 5 minutes (polling mode)\n\n" +
        `💡 **Want real-time notifications?** [Install the GitHub App](${result.installUrl})`;

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
  const { channelId, spaceId, args } = event;

  if (!repoArg) {
    await handler.sendMessage(
      channelId,
      "❌ Usage: `/github unsubscribe owner/repo [--events type1,type2]`"
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

  // Check for --events flag for granular unsubscribe
  const eventsIndex = args.findIndex(arg => arg.startsWith("--events"));

  if (eventsIndex !== -1) {
    // Granular unsubscribe - remove specific event types
    let eventTypesToRemove: string;

    // Parse event types
    if (args[eventsIndex].includes("=")) {
      eventTypesToRemove = args[eventsIndex].split("=")[1] || "";
    } else if (eventsIndex + 1 < args.length) {
      eventTypesToRemove = args[eventsIndex + 1];
    } else {
      await handler.sendMessage(
        channelId,
        "❌ Please specify event types to remove: `--events pr,issues`"
      );
      return;
    }

    const typesToRemove = eventTypesToRemove
      .split(",")
      .map(t => t.trim().toLowerCase())
      .filter(t => t.length > 0);

    if (typesToRemove.length === 0) {
      await handler.sendMessage(
        channelId,
        "❌ Please specify event types to remove: `--events pr,issues`"
      );
      return;
    }

    // Validate event types
    const allowedSet = new Set(ALLOWED_EVENT_TYPES);
    const invalidTypes = typesToRemove.filter(
      t => !allowedSet.has(t as (typeof ALLOWED_EVENT_TYPES)[number])
    );
    if (invalidTypes.length > 0) {
      await handler.sendMessage(
        channelId,
        `❌ Invalid event type(s): ${invalidTypes.join(", ")}\n\n` +
          `Valid options: ${ALLOWED_EVENT_TYPES.join(", ")}`
      );
      return;
    }

    // Compute actually removed types (intersection with current subscription)
    const existingTypes = subscription.eventTypes
      ? subscription.eventTypes.split(",").map(t => t.trim().toLowerCase())
      : [];
    const actuallyRemoved = existingTypes.filter(t =>
      typesToRemove.includes(t)
    );

    // Remove event types
    const removeResult = await subscriptionService.removeEventTypes(
      spaceId,
      channelId,
      subscription.repo,
      typesToRemove
    );

    if (!removeResult.success) {
      await handler.sendMessage(channelId, `❌ ${removeResult.error}`);
      return;
    }

    if (removeResult.deleted) {
      await handler.sendMessage(
        channelId,
        `✅ **Unsubscribed from ${repo}**\n\n` + `All event types were removed.`
      );
    } else {
      const removedLabel =
        actuallyRemoved.length > 0 ? actuallyRemoved.join(", ") : "(none)";
      const header =
        actuallyRemoved.length > 0
          ? `✅ **Updated subscription to ${repo}**\n\n`
          : `ℹ️ **Subscription to ${repo} unchanged**\n\n`;

      await handler.sendMessage(
        channelId,
        header +
          `Removed: **${removedLabel}**\n` +
          `Remaining: **${formatEventTypes(removeResult.eventTypes!)}**`
      );
    }
    return;
  }

  // Full unsubscribe - remove entire subscription
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
