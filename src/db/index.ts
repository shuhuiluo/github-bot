import { Database } from "bun:sqlite";
import { drizzle } from "drizzle-orm/bun-sqlite";
import { eq, and } from "drizzle-orm";
import { subscriptions, repoPollingState } from "./schema";

const sqlite = new Database("github-bot.db");
export const db = drizzle(sqlite);

// Create tables if they don't exist
sqlite.exec(`
  CREATE TABLE IF NOT EXISTS subscriptions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    channel_id TEXT NOT NULL,
    repo TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    UNIQUE(channel_id, repo)
  );

  CREATE TABLE IF NOT EXISTS repo_polling_state (
    repo TEXT PRIMARY KEY,
    etag TEXT,
    last_event_id TEXT,
    last_polled_at INTEGER,
    updated_at INTEGER NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_subscriptions_channel ON subscriptions(channel_id);
  CREATE INDEX IF NOT EXISTS idx_subscriptions_repo ON subscriptions(repo);
`);

/**
 * Database service for managing subscriptions and polling state
 */
export class DatabaseService {
  /**
   * Subscribe a channel to a repository
   * Handles concurrent requests gracefully with UNIQUE constraint
   */
  async subscribe(channelId: string, repo: string): Promise<void> {
    try {
      await db.insert(subscriptions).values({
        channelId,
        repo,
        createdAt: new Date(),
      });
    } catch (error) {
      // Ignore UNIQUE constraint violations (already subscribed)
      // SQLite error code for UNIQUE constraint: SQLITE_CONSTRAINT
      if (
        error instanceof Error &&
        error.message.includes("UNIQUE constraint failed")
      ) {
        return; // Already subscribed, no-op
      }
      throw error; // Re-throw other errors
    }
  }

  /**
   * Unsubscribe a channel from a repository
   */
  async unsubscribe(channelId: string, repo: string): Promise<boolean> {
    const result = db
      .delete(subscriptions)
      .where(
        and(
          eq(subscriptions.channelId, channelId),
          eq(subscriptions.repo, repo)
        )
      )
      .run() as unknown as { changes: number; lastInsertRowid: number };

    return result.changes > 0;
  }

  /**
   * Get all repositories a channel is subscribed to
   */
  async getChannelSubscriptions(channelId: string): Promise<string[]> {
    const results = await db
      .select({ repo: subscriptions.repo })
      .from(subscriptions)
      .where(eq(subscriptions.channelId, channelId));

    return results.map(r => r.repo);
  }

  /**
   * Get all channels subscribed to a repository
   */
  async getRepoSubscribers(repo: string): Promise<string[]> {
    const results = await db
      .select({ channelId: subscriptions.channelId })
      .from(subscriptions)
      .where(eq(subscriptions.repo, repo));

    return results.map(r => r.channelId);
  }

  /**
   * Get all unique repositories that have at least one subscriber
   */
  async getAllSubscribedRepos(): Promise<string[]> {
    const results = await db
      .selectDistinct({ repo: subscriptions.repo })
      .from(subscriptions);

    return results.map(r => r.repo);
  }

  /**
   * Get polling state for a repository
   */
  async getPollingState(repo: string): Promise<{
    etag?: string;
    lastEventId?: string;
    lastPolledAt?: Date;
  } | null> {
    const results = await db
      .select()
      .from(repoPollingState)
      .where(eq(repoPollingState.repo, repo))
      .limit(1);

    if (results.length === 0) {
      return null;
    }

    const state = results[0];
    return {
      etag: state.etag ?? undefined,
      lastEventId: state.lastEventId ?? undefined,
      lastPolledAt: state.lastPolledAt ?? undefined,
    };
  }

  /**
   * Update polling state for a repository
   */
  async updatePollingState(
    repo: string,
    state: {
      etag?: string;
      lastEventId?: string;
      lastPolledAt?: Date;
    }
  ): Promise<void> {
    const existing = await db
      .select()
      .from(repoPollingState)
      .where(eq(repoPollingState.repo, repo))
      .limit(1);

    if (existing.length === 0) {
      // Insert new state
      await db.insert(repoPollingState).values({
        repo,
        etag: state.etag ?? null,
        lastEventId: state.lastEventId ?? null,
        lastPolledAt: state.lastPolledAt ?? null,
        updatedAt: new Date(),
      });
    } else {
      // Update existing state
      await db
        .update(repoPollingState)
        .set({
          etag: state.etag ?? existing[0].etag,
          lastEventId: state.lastEventId ?? existing[0].lastEventId,
          lastPolledAt: state.lastPolledAt ?? existing[0].lastPolledAt,
          updatedAt: new Date(),
        })
        .where(eq(repoPollingState.repo, repo));
    }
  }

  /**
   * Check if a channel is subscribed to a repository
   */
  async isSubscribed(channelId: string, repo: string): Promise<boolean> {
    const results = await db
      .select()
      .from(subscriptions)
      .where(
        and(
          eq(subscriptions.channelId, channelId),
          eq(subscriptions.repo, repo)
        )
      )
      .limit(1);

    return results.length > 0;
  }
}

export const dbService = new DatabaseService();
