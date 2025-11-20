import { lt } from "drizzle-orm";

import { db } from "../db";
import { oauthStates } from "../db/schema";

/**
 * OAuthCleanupService - Manages cleanup of expired OAuth states
 *
 * OAuth states expire after 15 minutes but are only cleaned up when accessed.
 * This service proactively removes expired entries to prevent unbounded growth.
 */
export class OAuthCleanupService {
  /**
   * Clean up expired OAuth states from the database
   *
   * Removes all OAuth state entries where expiresAt is in the past.
   * Should be called periodically (e.g., every hour).
   *
   * @returns Number of expired states deleted
   */
  async cleanupExpiredStates(): Promise<number> {
    const now = new Date();

    try {
      const result = await db
        .delete(oauthStates)
        .where(lt(oauthStates.expiresAt, now))
        .returning({ state: oauthStates.state });

      const count = result.length;

      if (count > 0) {
        console.log(`[OAuth Cleanup] Removed ${count} expired OAuth states`);
      }

      return count;
    } catch (error) {
      console.error(
        "[OAuth Cleanup] Failed to clean up expired states:",
        error
      );
      throw error;
    }
  }

  /**
   * Start periodic cleanup with given interval
   *
   * @param intervalMs - Cleanup interval in milliseconds (default: 1 hour)
   * @returns Timer ID that can be used to stop the cleanup
   */
  startPeriodicCleanup(intervalMs: number = 60 * 60 * 1000): NodeJS.Timeout {
    console.log(
      `[OAuth Cleanup] Starting periodic cleanup (every ${intervalMs / 1000 / 60} minutes)`
    );

    // Run cleanup immediately on start
    this.cleanupExpiredStates().catch(error => {
      console.error("[OAuth Cleanup] Initial cleanup failed:", error);
    });

    // Schedule periodic cleanup
    return setInterval(() => {
      this.cleanupExpiredStates().catch(error => {
        console.error("[OAuth Cleanup] Periodic cleanup failed:", error);
      });
    }, intervalMs);
  }
}
