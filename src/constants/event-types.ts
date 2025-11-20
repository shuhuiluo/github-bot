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
