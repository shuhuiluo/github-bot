import { sqliteTable, text, integer, unique } from "drizzle-orm/sqlite-core";
import { DEFAULT_EVENT_TYPES } from "../constants/event-types";

/**
 * Stores channel subscriptions to GitHub repositories
 */
export const subscriptions = sqliteTable(
  "subscriptions",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    channelId: text("channel_id").notNull(),
    repo: text("repo").notNull(), // Format: "owner/repo"
    eventTypes: text("event_types").notNull().default(DEFAULT_EVENT_TYPES), // Comma-separated event types
    createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
  },
  table => ({
    uniqueChannelRepo: unique().on(table.channelId, table.repo),
  })
);

/**
 * Stores polling state for each subscribed repository
 * Tracks ETags and last seen event IDs for efficient polling
 */
export const repoPollingState = sqliteTable("repo_polling_state", {
  repo: text("repo").primaryKey(), // Format: "owner/repo"
  etag: text("etag"), // GitHub ETag for conditional requests
  lastEventId: text("last_event_id"), // Last seen event ID to avoid duplicates
  lastPolledAt: integer("last_polled_at", { mode: "timestamp" }),
  updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
});
