import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  index,
  integer,
  pgTable,
  primaryKey,
  serial,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

import { DEFAULT_EVENT_TYPES } from "../constants";

/**
 * Stores OAuth tokens for GitHub users linked to Towns users
 */
export const githubUserTokens = pgTable(
  "github_user_tokens",
  {
    townsUserId: text("towns_user_id").primaryKey(),
    githubUserId: integer("github_user_id").notNull(),
    githubLogin: text("github_login").notNull(),
    accessToken: text("access_token").notNull(), // Encrypted
    tokenType: text("token_type").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    refreshToken: text("refresh_token"),
    refreshTokenExpiresAt: timestamp("refresh_token_expires_at", {
      withTimezone: true,
    }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
  },
  table => ({
    // Enforce 1:1 mapping between GitHub accounts and Towns users
    githubUserIdUnique: uniqueIndex(
      "github_user_tokens_github_user_id_unique"
    ).on(table.githubUserId),
  })
);

/**
 * Stores OAuth state parameters for security during OAuth flow
 */
export const oauthStates = pgTable(
  "oauth_states",
  {
    state: text("state").primaryKey(),
    townsUserId: text("towns_user_id").notNull(),
    channelId: text("channel_id").notNull(),
    spaceId: text("space_id").notNull(),
    redirectAction: text("redirect_action"), // 'subscribe' etc
    redirectData: text("redirect_data"), // JSON string with additional context
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
  },
  table => ({
    expiresIndex: index("idx_oauth_states_expires").on(table.expiresAt),
    townsUserIndex: index("idx_oauth_states_towns_user_id").on(
      table.townsUserId
    ),
  })
);

/**
 * Stores channel subscriptions to GitHub repositories with delivery mode tracking
 * Replaces the legacy subscriptions table with OAuth and private repo support
 */
export const githubSubscriptions = pgTable(
  "github_subscriptions",
  {
    id: serial("id").primaryKey(),
    spaceId: text("space_id").notNull(),
    channelId: text("channel_id").notNull(),
    repoFullName: text("repo_full_name").notNull(), // Format: "owner/repo"
    deliveryMode: text("delivery_mode").notNull(), // 'webhook' or 'polling'
    isPrivate: boolean("is_private").notNull(),
    createdByTownsUserId: text("created_by_towns_user_id")
      .notNull()
      .references(() => githubUserTokens.townsUserId, { onDelete: "cascade" }),
    createdByGithubLogin: text("created_by_github_login"),
    installationId: integer("installation_id").references(
      () => githubInstallations.installationId,
      { onDelete: "set null" }
    ),
    // Note: 'enabled' is reserved for future soft-delete functionality
    // Currently always true - not used for filtering subscriptions
    enabled: boolean("enabled").notNull().default(true),
    eventTypes: text("event_types").notNull().default(DEFAULT_EVENT_TYPES), // Comma-separated event types
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
  },
  table => ({
    deliveryModeCheck: check(
      "delivery_mode_check",
      sql`${table.deliveryMode} IN ('webhook', 'polling')`
    ),
    uniqueSubscription: uniqueIndex("github_subscriptions_unique_idx").on(
      table.spaceId,
      table.channelId,
      table.repoFullName
    ),
    channelIndex: index("idx_github_subscriptions_channel").on(table.channelId),
    repoIndex: index("idx_github_subscriptions_repo").on(table.repoFullName),
  })
);

/**
 * Stores polling state for each subscribed repository
 * Tracks ETags and last seen event IDs for efficient polling
 */
export const repoPollingState = pgTable("repo_polling_state", {
  repo: text("repo").primaryKey(), // Format: "owner/repo"
  etag: text("etag"), // GitHub ETag for conditional requests
  lastEventId: text("last_event_id"), // Last seen event ID to avoid duplicates
  lastPolledAt: timestamp("last_polled_at", { withTimezone: true }),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
});

/**
 * Stores GitHub App installations
 * Tracks which accounts have installed the GitHub App
 */
export const githubInstallations = pgTable(
  "github_installations",
  {
    installationId: integer("installation_id").primaryKey(),
    accountLogin: text("account_login").notNull(),
    accountType: text("account_type").notNull(), // "Organization" or "User"
    installedAt: timestamp("installed_at", { withTimezone: true }).notNull(),
    suspendedAt: timestamp("suspended_at", { withTimezone: true }),
    appSlug: text("app_slug").notNull().default("towns-github-bot"),
  },
  table => ({
    accountTypeCheck: check(
      "account_type_check",
      sql`${table.accountType} IN ('Organization', 'User')`
    ),
  })
);

/**
 * Stores repositories for each GitHub App installation
 * Normalized table - NO JSON columns (proper SQLite design)
 */
export const installationRepositories = pgTable(
  "installation_repositories",
  {
    installationId: integer("installation_id")
      .notNull()
      .references(() => githubInstallations.installationId, {
        onDelete: "cascade",
      }),
    repoFullName: text("repo_full_name").notNull(), // Format: "owner/repo"
    addedAt: timestamp("added_at", { withTimezone: true }).notNull(),
  },
  table => ({
    pk: primaryKey({ columns: [table.installationId, table.repoFullName] }),
    repoIndex: index("idx_installation_repos_by_name").on(table.repoFullName),
    installationIndex: index("idx_installation_repos_by_install").on(
      table.installationId
    ),
  })
);

/**
 * Stores webhook delivery tracking for idempotency
 * Uses X-GitHub-Delivery header as primary key
 */
export const webhookDeliveries = pgTable(
  "webhook_deliveries",
  {
    deliveryId: text("delivery_id").primaryKey(), // X-GitHub-Delivery header value
    installationId: integer("installation_id"),
    eventType: text("event_type").notNull(),
    deliveredAt: timestamp("delivered_at", { withTimezone: true }).notNull(),
    status: text("status").notNull().default("pending"), // "pending", "success", "failed"
    error: text("error"),
    retryCount: integer("retry_count").notNull().default(0),
  },
  table => ({
    statusCheck: check(
      "status_check",
      sql`${table.status} IN ('pending', 'success', 'failed')`
    ),
    statusIndex: index("idx_deliveries_status").on(
      table.status,
      table.deliveredAt
    ),
  })
);
