import { eq, lt } from "drizzle-orm";

import { db } from "../db";
import { webhookDeliveries } from "../db/schema";

/**
 * WebhookProcessor - Handles webhook idempotency and delivery tracking
 *
 * Prevents duplicate processing of webhook deliveries using the
 * X-GitHub-Delivery header as a unique identifier.
 */
export class WebhookProcessor {
  /**
   * Check if a webhook delivery has already been processed
   *
   * @param deliveryId - X-GitHub-Delivery header value
   * @returns true if already processed, false otherwise
   */
  async isProcessed(deliveryId: string): Promise<boolean> {
    const result = await db
      .select()
      .from(webhookDeliveries)
      .where(eq(webhookDeliveries.deliveryId, deliveryId))
      .limit(1);

    return result.length > 0;
  }

  /**
   * Mark a webhook delivery as processed
   *
   * @param deliveryId - X-GitHub-Delivery header value
   * @param installationId - GitHub App installation ID (optional)
   * @param eventType - GitHub event type (e.g., "pull_request", "push")
   * @param status - Processing status ("success" or "failed")
   * @param error - Error message if failed (optional)
   */
  async markProcessed(
    deliveryId: string,
    installationId: number | undefined,
    eventType: string,
    status: "success" | "failed" = "success",
    error?: string
  ): Promise<void> {
    await db.insert(webhookDeliveries).values({
      deliveryId,
      installationId: installationId ?? null,
      eventType,
      deliveredAt: new Date(),
      status,
      error: error ?? null,
      retryCount: 0,
    });
  }

  /**
   * Clean up old webhook delivery records
   * Call this periodically to prevent the table from growing indefinitely
   *
   * @param daysToKeep - Number of days to keep records (default: 7)
   */
  async cleanup(daysToKeep: number = 7): Promise<number> {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - daysToKeep);

    const result = await db
      .delete(webhookDeliveries)
      .where(lt(webhookDeliveries.deliveredAt, cutoffDate))
      .returning();

    return result.length;
  }
}
