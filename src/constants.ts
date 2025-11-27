/** Default event types as array for code layer */
export const DEFAULT_EVENT_TYPES_ARRAY: readonly EventType[] = [
  "pr",
  "issues",
  "commits",
  "releases",
];

/**
 * Default event types for GitHub subscriptions (string for DB storage)
 */
export const DEFAULT_EVENT_TYPES = DEFAULT_EVENT_TYPES_ARRAY.join(",");

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

/** Pre-allocated Set for O(1) event type validation */
export const ALLOWED_EVENT_TYPES_SET: ReadonlySet<EventType> = new Set(
  ALLOWED_EVENT_TYPES
);

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

/**
 * Pending subscription expiration time (1 hour)
 * How long to wait for GitHub App installation before expiring
 */
export const PENDING_SUBSCRIPTION_EXPIRATION_MS = 60 * 60 * 1000;

/**
 * Pending subscription cleanup interval (1 hour)
 * How often to check for and remove expired pending subscriptions
 */
export const PENDING_SUBSCRIPTION_CLEANUP_INTERVAL_MS = 60 * 60 * 1000;

/**
 * OAuth token refresh buffer (5 minutes)
 * Proactively refresh tokens that expire within this window.
 * GitHub access tokens expire after 8 hours, refresh tokens after 6 months.
 */
export const OAUTH_TOKEN_REFRESH_BUFFER_MS = 5 * 60 * 1000;
