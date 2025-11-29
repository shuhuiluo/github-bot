import type { EventType } from "../constants";
import type { BranchFilter } from "../services/subscription-service";

/**
 * Format delivery mode info for subscription messages
 */
export function formatDeliveryInfo(
  deliveryMode: "webhook" | "polling",
  installUrl?: string
): string {
  return deliveryMode === "webhook"
    ? "⚡ Real-time webhook delivery enabled!"
    : `⏱️ Events checked every 5 minutes\n\n💡 [Install the GitHub App](${installUrl}) for real-time delivery`;
}

/**
 * Format branch filter for display
 */
export function formatBranchFilter(branchFilter: BranchFilter): string {
  if (!branchFilter) return "default branch";
  if (branchFilter === "all") return "all branches";
  return branchFilter;
}

/**
 * Format subscription success message
 */
export function formatSubscriptionSuccess(
  repoFullName: string,
  eventTypes: EventType[],
  branchFilter: BranchFilter,
  deliveryInfo: string
): string {
  const branchInfo = formatBranchFilter(branchFilter);
  return (
    `✅ **Subscribed to [${repoFullName}](https://github.com/${repoFullName})**\n\n` +
    `📡 Events: **${eventTypes.join(", ")}**\n` +
    `🌿 Branches: **${branchInfo}**\n\n${deliveryInfo}`
  );
}
