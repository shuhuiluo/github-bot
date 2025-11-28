import type { EventType } from "../constants";

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
 * Format subscription success message
 */
export function formatSubscriptionSuccess(
  repoFullName: string,
  eventTypes: EventType[],
  deliveryInfo: string
): string {
  return (
    `✅ **Subscribed to [${repoFullName}](https://github.com/${repoFullName})**\n\n` +
    `📡 Event types: **${eventTypes.join(", ")}**\n\n${deliveryInfo}`
  );
}
