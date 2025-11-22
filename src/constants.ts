/**
 * Default event types for GitHub subscriptions
 * This constant is imported and used across the codebase to ensure consistency
 */
export const DEFAULT_EVENT_TYPES = "pr,issues,commits,releases";

/**
 * Allowed event types that users can subscribe to
 */
export const ALLOWED_EVENT_TYPES = [
  "pr",
  "issues",
  "commits",
  "releases",
  "ci",
  "comments",
  "reviews",
  "branches",
  "review_comments",
  "stars",
  "forks",
] as const;

/**
 * Event type union extracted from ALLOWED_EVENT_TYPES
 */
export type EventType = (typeof ALLOWED_EVENT_TYPES)[number];

/**
 * Pending message cleanup interval (30 seconds)
 * How often to check for and remove stale pending messages
 */
export const PENDING_MESSAGE_CLEANUP_INTERVAL_MS = 30000;

/**
 * Pending message max age (60 seconds)
 * Messages older than this are considered stale and removed
 */
export const PENDING_MESSAGE_MAX_AGE_MS = 60000;
