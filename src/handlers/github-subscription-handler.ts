import type { BotHandler } from "@towns-protocol/bot";

import {
  ALLOWED_EVENT_TYPES,
  ALLOWED_EVENT_TYPES_SET,
  DEFAULT_EVENT_TYPES,
  DEFAULT_EVENT_TYPES_ARRAY,
  type EventType,
} from "../constants";
import { formatBranchFilter } from "../formatters/subscription-messages";
import {
  TokenStatus,
  type GitHubOAuthService,
} from "../services/github-oauth-service";
import type {
  BranchFilter,
  SubscriptionService,
} from "../services/subscription-service";
import type { SlashCommandEvent } from "../types/bot";
import { handleInvalidOAuthToken } from "../utils/oauth-helpers";
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
      "**Usage:**\n\n" +
        `- \`/github subscribe owner/repo [--events all,${ALLOWED_EVENT_TYPES.join(",")}] [--branches main,release/*]\` - Subscribe to GitHub events or add event types\n\n` +
        "- `/github unsubscribe owner/repo [--events type1,type2]` - Unsubscribe from a repository or remove specific event types\n\n" +
        "- `/github status` - Show current subscriptions"
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
      await handleUnsubscribe(
        handler,
        event,
        subscriptionService,
        oauthService,
        repoArg
      );
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
  const { channelId, spaceId, args } = event;

  if (!repoArg) {
    await handler.sendMessage(
      channelId,
      `❌ Usage: \`/github subscribe owner/repo [--events all,${ALLOWED_EVENT_TYPES.join(",")}] [--branches main,release/*]\``
    );
    return;
  }

  const repo = parseRepoArg(repoArg);
  if (!repo) {
    await handler.sendMessage(
      channelId,
      "❌ Invalid format. Use: `owner/repo` (e.g., `facebook/react`)"
    );
    return;
  }

  const hasEventsFlag = args.some(arg => arg.startsWith("--events"));
  const hasBranchesFlag = args.some(arg => arg.startsWith("--branches"));

  // Parse and validate event types from args
  let eventTypes: EventType[];
  try {
    eventTypes = parseEventTypes(args);
  } catch (error) {
    const errorMessage =
      error instanceof Error ? error.message : "Invalid event types";
    await handler.sendMessage(channelId, `❌ ${errorMessage}`);
    return;
  }

  // Parse branch filter
  const branchFilter = parseBranchFilter(args);

  // Check if already subscribed - if so, add event types instead (case-insensitive match)
  const channelSubscriptions =
    await subscriptionService.getChannelSubscriptions(channelId, spaceId);
  const existingSubscription = channelSubscriptions.find(
    sub => sub.repo.toLowerCase() === repo.toLowerCase()
  );

  if (existingSubscription && (hasEventsFlag || hasBranchesFlag)) {
    // Only pass event types if --events flag was used, otherwise pass empty array
    // to avoid adding default event types when only --branches is specified
    const eventTypesToUpdate = hasEventsFlag ? eventTypes : [];
    return handleUpdateSubscription(
      handler,
      event,
      subscriptionService,
      oauthService,
      existingSubscription,
      eventTypesToUpdate,
      branchFilter
    );
  }

  if (existingSubscription) {
    await handler.sendMessage(
      channelId,
      `❌ Already subscribed to **${existingSubscription.repo}**\n\n` +
        "Use `--events` to add specific event types, or `/github status` to view current settings."
    );
    return;
  }

  return handleNewSubscription(
    handler,
    event,
    subscriptionService,
    oauthService,
    repo,
    eventTypes,
    branchFilter
  );
}

/**
 * Handle new subscription (no existing subscription for this repo)
 */
async function handleNewSubscription(
  handler: BotHandler,
  event: SlashCommandEvent,
  subscriptionService: SubscriptionService,
  oauthService: GitHubOAuthService,
  repo: string,
  eventTypes: EventType[],
  branchFilter: BranchFilter
): Promise<void> {
  const { channelId, spaceId, userId } = event;

  // Check if user has linked their GitHub account and token is valid
  const tokenStatus = await oauthService.validateToken(userId);

  if (tokenStatus !== TokenStatus.Valid) {
    await handleInvalidOAuthToken(
      tokenStatus,
      oauthService,
      handler,
      userId,
      channelId,
      spaceId,
      "subscribe",
      { repo, eventTypes, branchFilter }
    );
    return;
  }

  // Create subscription
  const result = await subscriptionService.createSubscription({
    townsUserId: userId,
    spaceId,
    channelId,
    repoIdentifier: repo,
    eventTypes,
    branchFilter,
  });

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

  if (!result.success) {
    await handler.sendMessage(channelId, `❌ ${result.error}`);
    return;
  }

  await subscriptionService.sendSubscriptionSuccess(
    result,
    eventTypes,
    branchFilter,
    channelId,
    handler
  );
}

/**
 * Handle update to existing subscription (add event types or update branch filter)
 */
async function handleUpdateSubscription(
  handler: BotHandler,
  event: SlashCommandEvent,
  subscriptionService: SubscriptionService,
  oauthService: GitHubOAuthService,
  existingSubscription: {
    repo: string;
    deliveryMode: string;
    branchFilter: BranchFilter;
  },
  eventTypes: EventType[],
  branchFilter: BranchFilter
): Promise<void> {
  const { channelId, spaceId, userId } = event;
  const { repo } = existingSubscription;

  // Check if user has linked their GitHub account and token is valid
  const tokenStatus = await oauthService.validateToken(userId);

  if (tokenStatus !== TokenStatus.Valid) {
    await handleInvalidOAuthToken(
      tokenStatus,
      oauthService,
      handler,
      userId,
      channelId,
      spaceId,
      "subscribe-update",
      { repo, eventTypes, branchFilter }
    );
    return;
  }

  // Update subscription (add event types and/or update branch filter)
  const updateResult = await subscriptionService.updateSubscription(
    userId,
    spaceId,
    channelId,
    repo,
    eventTypes,
    branchFilter
  );

  if (!updateResult.success) {
    await handler.sendMessage(channelId, `❌ ${updateResult.error}`);
    return;
  }

  const mode = existingSubscription.deliveryMode === "webhook" ? "⚡" : "⏱️";
  const branchInfo = formatBranchFilter(updateResult.branchFilter ?? null);
  await handler.sendMessage(
    channelId,
    `✅ **Updated subscription to ${repo}**\n\n` +
      `${mode} Events: **${formatEventTypes(updateResult.eventTypes ?? [])}**\n` +
      `🌿 Branches: **${branchInfo}**`
  );
}

/**
 * Handle unsubscribe action
 */
async function handleUnsubscribe(
  handler: BotHandler,
  event: SlashCommandEvent,
  subscriptionService: SubscriptionService,
  oauthService: GitHubOAuthService,
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

  const repo = parseRepoArg(repoArg);
  if (!repo) {
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
    return handleRemoveEventTypes(
      handler,
      event,
      subscriptionService,
      oauthService,
      subscription.repo,
      subscription.eventTypes,
      eventsIndex
    );
  }

  // Full unsubscribe
  return handleFullUnsubscribe(
    handler,
    event,
    subscriptionService,
    oauthService,
    subscription.repo,
    subscription.eventTypes
  );
}

/**
 * Handle removing specific event types from a subscription
 */
async function handleRemoveEventTypes(
  handler: BotHandler,
  event: SlashCommandEvent,
  subscriptionService: SubscriptionService,
  oauthService: GitHubOAuthService,
  repo: string,
  eventTypes: EventType[],
  eventsIndex: number
): Promise<void> {
  const { channelId, spaceId, userId, args } = event;

  // Parse event types
  let eventTypesToRemove = "";
  if (args[eventsIndex].includes("=")) {
    eventTypesToRemove = args[eventsIndex].split("=")[1] || "";
  } else if (eventsIndex + 1 < args.length) {
    eventTypesToRemove = args[eventsIndex + 1];
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

  // Check if user has linked their GitHub account and token is valid
  const tokenStatus = await oauthService.validateToken(userId);

  if (tokenStatus !== TokenStatus.Valid) {
    await handleInvalidOAuthToken(
      tokenStatus,
      oauthService,
      handler,
      userId,
      channelId,
      spaceId,
      "unsubscribe-update",
      { repo, eventTypes: typesToRemove as EventType[] }
    );
    return;
  }

  // Compute actually removed types (intersection with current subscription)
  const actuallyRemoved = eventTypes.filter(t =>
    (typesToRemove as EventType[]).includes(t)
  );

  // Remove event types (validates repo access)
  const removeResult = await subscriptionService.removeEventTypes(
    userId,
    spaceId,
    channelId,
    repo,
    typesToRemove as EventType[]
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
}

/**
 * Handle full unsubscribe from a repository
 */
async function handleFullUnsubscribe(
  handler: BotHandler,
  event: SlashCommandEvent,
  subscriptionService: SubscriptionService,
  oauthService: GitHubOAuthService,
  repo: string,
  eventTypes: EventType[]
): Promise<void> {
  const { channelId, spaceId, userId } = event;

  // Check if user has linked their GitHub account and token is valid
  const tokenStatus = await oauthService.validateToken(userId);

  if (tokenStatus !== TokenStatus.Valid) {
    await handleInvalidOAuthToken(
      tokenStatus,
      oauthService,
      handler,
      userId,
      channelId,
      spaceId,
      "unsubscribe-update",
      { repo, eventTypes }
    );
    return;
  }

  // Use removeEventTypes with all event types - validates repo access and deletes subscription
  const removeResult = await subscriptionService.removeEventTypes(
    userId,
    spaceId,
    channelId,
    repo,
    eventTypes
  );

  if (!removeResult.success) {
    await handler.sendMessage(channelId, `❌ ${removeResult.error}`);
    return;
  }

  await handler.sendMessage(channelId, `✅ **Unsubscribed from ${repo}**`);
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
      const branchInfo = formatBranchFilter(sub.branchFilter);
      return `${mode} ${sub.repo}\n   Events: ${formatEventTypes(sub.eventTypes)}\n   Branches: ${branchInfo}`;
    })
    .join("\n\n");

  await handler.sendMessage(
    channelId,
    `📬 **Subscribed Repositories (${subscriptions.length}):**\n\n${repoList}\n\n` +
      `⚡ Real-time  ⏱️ Polling (5 min)`
  );
}

/**
 * Parse and validate repo argument (strips markdown, validates owner/repo format)
 * Returns null if invalid format
 */
function parseRepoArg(repoArg: string): string | null {
  const repo = stripMarkdown(repoArg);
  if (!repo.includes("/") || repo.split("/").length !== 2) {
    return null;
  }
  return repo;
}

/**
 * Parse and validate event types from --events flag
 * Returns default types if no flag, or validated event types array
 * @throws Error if any event type is invalid
 */
function parseEventTypes(args: string[]): EventType[] {
  const eventsIndex = args.findIndex(arg => arg.startsWith("--events"));
  if (eventsIndex === -1) return [...DEFAULT_EVENT_TYPES_ARRAY];

  let rawEventTypes: string;

  // Check for --events=pr,issues format
  if (args[eventsIndex].includes("=")) {
    rawEventTypes = args[eventsIndex].split("=")[1] || DEFAULT_EVENT_TYPES;
  } else if (eventsIndex + 1 < args.length) {
    // Check for --events pr,issues format (next arg)
    rawEventTypes = args[eventsIndex + 1];
  } else {
    return [...DEFAULT_EVENT_TYPES_ARRAY];
  }

  // Parse and validate event types
  const tokens = rawEventTypes
    .split(",")
    .map(token => token.trim().toLowerCase())
    .filter(token => token.length > 0);

  // Handle "all" as special case
  if (tokens.includes("all")) {
    return [...ALLOWED_EVENT_TYPES];
  }

  // Validate each token
  const invalidTokens: string[] = [];
  for (const token of tokens) {
    if (!ALLOWED_EVENT_TYPES_SET.has(token as EventType)) {
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

  // Remove duplicates and return
  return [...new Set(tokens)] as EventType[];
}

/**
 * Format event types for display
 */
function formatEventTypes(eventTypes: EventType[]): string {
  return eventTypes.join(", ");
}

/**
 * Parse branch filter from --branches flag
 * Returns null if no flag (default branch only), or the specified filter
 *
 * Examples:
 *   --branches main,develop    returns "main,develop"
 *   --branches release/*       returns "release/*"
 *   --branches all             returns "all"
 *   --branches *               returns "all"
 *   (no flag)                  returns null (default branch only)
 */
function parseBranchFilter(args: string[]): BranchFilter {
  const branchesIndex = args.findIndex(arg => arg.startsWith("--branches"));
  if (branchesIndex === -1) return null;

  let rawBranches: string;

  // Check for --branches=main,develop format
  if (args[branchesIndex].includes("=")) {
    rawBranches = args[branchesIndex].split("=")[1] || "";
  } else if (branchesIndex + 1 < args.length) {
    // Check for --branches main,develop format (next arg)
    rawBranches = args[branchesIndex + 1];
  } else {
    return null;
  }

  const trimmed = rawBranches.trim();
  if (!trimmed) return null;

  // Normalize "all" and "*" to "all"
  if (trimmed.toLowerCase() === "all" || trimmed === "*") {
    return "all";
  }

  return trimmed;
}
