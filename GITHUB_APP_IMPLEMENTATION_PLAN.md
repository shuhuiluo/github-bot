# GitHub App Implementation Plan

## Overview

This document describes the GitHub App integration for the Towns Protocol bot, which bridges GitHub activity with Towns channels through real-time webhooks and fallback polling.

### Towns Protocol Context

**Towns Protocol** is a decentralized communication platform where users organize into **spaces** (communities) containing **channels** (topic-specific streams). Users interact via:

- **Slash commands** (e.g., `/github subscribe owner/repo`)
- **Messages** with bot mentions and replies
- **Reactions** and threaded conversations

The bot receives Towns events via webhooks at `/webhook`, processes them, and sends formatted messages back to channels.

## Problem: Events API Limitations

GitHub's Events API has critical limitations:

| Issue                   | Impact                                      |
| ----------------------- | ------------------------------------------- |
| Missing PR merge events | No notifications when PRs are closed/merged |
| Empty commit data       | Push events contain `commits: []`           |
| 5-minute polling delay  | Not real-time                               |
| Best-effort delivery    | No guarantees on completeness               |

**Root cause**: Events API is designed for activity feeds, not reliable event delivery.

## Solution: GitHub App with Dual-Mode Operation

### Architecture

```
┌─────────────────────────────────────────────┐
│          Single Hono Application            │
├─────────────────────────────────────────────┤
│                                             │
│  POST /webhook         ← Towns Protocol     │
│  POST /github-webhook  ← GitHub App         │
│  GET  /health         ← Health checks       │
│                                             │
│  • Single process, single database          │
│  • Deployed on Render                       │
│  • Dual-mode: webhooks OR polling           │
└─────────────────────────────────────────────┘
```

### Delivery Modes

**Real-time Webhooks (Preferred):**

- Requires GitHub App installation on repository
- Instant delivery (< 1 second latency)
- Works for public AND private repos
- Complete event data guaranteed

**Polling Fallback (Legacy):**

- No installation required
- 5-minute polling interval
- Only works for **public** repos
- Missing events (PR merges, commit data)

### Key Design Decisions

1. **Dual-mode architecture**: Automatically use webhooks when app installed, fall back to polling otherwise
2. **No manual webhook configuration**: GitHub App manages webhooks automatically
3. **Idempotency**: Track webhook deliveries by `X-GitHub-Delivery` header to prevent duplicates
4. **Database-backed state**: All installation and delivery state persisted in SQLite
5. **Foreign key CASCADE**: Auto-cleanup when installations deleted

## Database Schema

### github_installations

```sql
CREATE TABLE github_installations (
  installation_id INTEGER PRIMARY KEY,
  account_login TEXT NOT NULL,
  account_type TEXT NOT NULL CHECK(account_type IN ('Organization', 'User')),
  installed_at INTEGER NOT NULL,
  suspended_at INTEGER,
  app_slug TEXT NOT NULL DEFAULT 'towns-github-bot'
);
```

### installation_repositories

```sql
CREATE TABLE installation_repositories (
  installation_id INTEGER NOT NULL,
  repo_full_name TEXT NOT NULL,
  added_at INTEGER NOT NULL,
  PRIMARY KEY (installation_id, repo_full_name),
  FOREIGN KEY (installation_id)
    REFERENCES github_installations(installation_id)
    ON DELETE CASCADE
);

CREATE INDEX idx_installation_repos_by_name ON installation_repositories(repo_full_name);
```

### github_subscriptions

```sql
CREATE TABLE github_subscriptions (
  subscription_id INTEGER PRIMARY KEY AUTOINCREMENT,
  space_id TEXT NOT NULL,
  channel_id TEXT NOT NULL,
  repo_full_name TEXT NOT NULL,
  delivery_mode TEXT NOT NULL CHECK (delivery_mode IN ('webhook', 'polling')),
  is_private INTEGER NOT NULL CHECK (is_private IN (0, 1)),
  created_by_towns_user_id TEXT NOT NULL,
  created_by_github_login TEXT,
  installation_id INTEGER,
  enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE(space_id, channel_id, repo_full_name),
  FOREIGN KEY (installation_id)
    REFERENCES github_installations(installation_id)
    ON DELETE SET NULL
);

CREATE INDEX idx_subscriptions_by_repo ON github_subscriptions(repo_full_name);
CREATE INDEX idx_subscriptions_by_channel ON github_subscriptions(channel_id);
```

### webhook_deliveries

```sql
CREATE TABLE webhook_deliveries (
  delivery_id TEXT PRIMARY KEY,  -- X-GitHub-Delivery header
  installation_id INTEGER,
  event_type TEXT NOT NULL,
  delivered_at INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK(status IN ('pending', 'success', 'failed')),
  error TEXT,
  retry_count INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX idx_deliveries_status ON webhook_deliveries(status, delivered_at);
```

**Note**: `installation_id` in `webhook_deliveries` is nullable because some webhook events don't have installation context. No foreign key constraint to preserve audit trail.

## Component Architecture

### Core Components

**Implemented in `src/github-app/`:**

1. **GitHubApp** (`app.ts`)
   - Octokit App initialization
   - Webhook event registration
   - Public `webhooks` property for route registration

2. **EventProcessor** (`event-processor.ts`)
   - Routes webhook events to formatters
   - Filters by channel event type preferences
   - Sends to subscribed Towns channels

3. **InstallationService** (`installation-service.ts`)
   - Handles installation lifecycle (created/deleted)
   - Manages repository additions/removals
   - Checks installation status per repo
   - Notifies Towns channels of mode changes

4. **WebhookProcessor** (`webhook-processor.ts`)
   - Idempotency tracking via deliveryId
   - Cleanup of old webhook records
   - Database-backed (no in-memory state)

### Event Flow

```
GitHub Event
  → POST /github-webhook
  → JWT verify + HMAC signature check (Octokit)
  → Check idempotency (webhook_deliveries table)
  → EventProcessor routes to formatter
  → Filter by channel preferences
  → Send to Towns channels
  → Mark as processed (success only)
```

**Critical**: Failed webhooks are NOT marked as processed, allowing GitHub's retry mechanism to work.

## Type System

### Webhook Types

Using `@octokit/webhooks` official types:

```typescript
import type {
  EmitterWebhookEvent,
  EmitterWebhookEventName,
} from "@octokit/webhooks";

type WebhookPayload<T extends EmitterWebhookEventName> =
  EmitterWebhookEvent<T>["payload"];

export type PullRequestPayload = WebhookPayload<"pull_request">;
export type IssuesPayload = WebhookPayload<"issues">;
// ... etc
```

**Why not `@octokit/webhooks-types`?** That package is legacy (community JSON schemas). `@octokit/webhooks` uses official OpenAPI types.

## Subscription Flow

### Improved UX: Single OAuth Flow

**Goal:** User only leaves Towns app once. Subscription created automatically during OAuth callback.

### Flow Overview

```
/github subscribe owner/repo
  ↓
Ephemeral OAuth URL (security: only visible to requesting user)
  ↓
User authorizes on GitHub
  ↓
OAuth Callback:
  - Creates subscription immediately
  - Determines delivery mode (webhook/polling)
  - Returns success page with:
    * Confirmation: "Subscribed to owner/repo!"
    * If webhook: Just success
    * If polling: Install instructions + auto-redirect countdown (5s)
  ↓
[Optional] User installs GitHub App
  ↓
Installation webhook → Automatically upgrades polling to webhook
```

### Detailed Implementation

#### 1. Slash Command Handler (`/github subscribe owner/repo`)

**Purpose:** Validate input and show OAuth URL

**Steps:**

1. Validate repository format (`owner/repo`)
2. Parse optional `--events` flag
3. Check if user has OAuth token:
   - **No token:** Show ephemeral OAuth URL with subscription params in state
   - **Has token:** This flow is deprecated (subscription now created in OAuth callback)

**OAuth URL State Parameter:**

```json
{
  "action": "subscribe",
  "townsUserId": "0x...",
  "spaceId": "...",
  "channelId": "...",
  "repo": "owner/repo",
  "eventTypes": "pr,issues,commits,..."
}
```

**Security:** OAuth URL sent as `ephemeral: true` message (only visible to requesting user)

#### 2. OAuth Callback (`/oauth/callback`)

**Purpose:** Create subscription immediately after authorization

**Steps:**

1. **Decode state and get user token:**
   - Parse subscription params from OAuth state
   - Retrieve newly created OAuth token for user

2. **Resolve and validate repository:**
   - Call `GET /repos/{owner}/{repo}` using user's OAuth token
   - If 404/403 → return error page: "You don't have access to this repository"
   - Extract from response:
     - `repo_full_name` (normalized owner/repo)
     - `private` flag (true/false)
     - `owner.login`, `owner.type`, `owner.id`

3. **Determine delivery mode:**
   - Query `installation_repositories` to check if app installed
   - **If private repo:**
     - Installed → `delivery_mode = 'webhook'`
     - Not installed → return error page: "Private repo requires GitHub App installation"
   - **If public repo:**
     - Installed → `delivery_mode = 'webhook'`
     - Not installed → `delivery_mode = 'polling'`

4. **Create subscription in database:**
   - Insert into `github_subscriptions` table
   - Include all metadata: `space_id`, `channel_id`, `repo_full_name`, `delivery_mode`, etc.

5. **Return success page:**

**Success Page Format:**

```html
<!-- Webhook mode -->
✅ Subscribed to owner/repo! ⚡ Real-time webhook delivery enabled Events: Pull
requests, Issues, Commits, ... You can close this window and return to Towns.

<!-- Polling mode -->
✅ Subscribed to owner/repo! ⏱️ Currently using 5-minute polling 💡 For
real-time updates, install the GitHub App: [Install GitHub App Button]
Auto-redirecting to installation in 5 seconds...
<countdown timer> You can close this window and return to Towns.</countdown>
```

**Smart Installation URL:**

- Pre-selects target account using `target_id=<owner.id>`
- Example: `https://github.com/apps/towns-github-bot/installations/new/permissions?target_id=12345`

**Admin Detection:**

- Personal repos: `owner.type == 'User' && owner.login == github_user.login`
- Org repos: Check `GET /user/memberships/orgs/{owner.login}` for `role == 'admin'`
- Customize messaging: "You can install..." vs "Ask an admin to install..."

#### 3. Installation Webhook Handler

**Purpose:** Automatically upgrade subscriptions when app is installed

**Already Implemented** (`InstallationService.upgradeToWebhook()`):

- Triggered by `installation.created` and `installation_repositories.added` events
- Finds subscriptions with `delivery_mode = 'polling'` for the installed repo
- Updates to `delivery_mode = 'webhook'` and sets `installation_id`
- Sends notification to affected channels: "🔄 Upgraded owner/repo to real-time webhook delivery!"

**No changes needed** - this already works correctly.

### Key Benefits of New Flow

1. **Single OAuth flow:** User only leaves Towns once (vs 2-3 times before)
2. **Automatic subscription:** Created during OAuth callback (no re-running command)
3. **Clear upgrade path:** Success page shows installation instructions with countdown
4. **Security:** OAuth URLs are ephemeral (prevent account hijacking)
5. **Seamless upgrade:** Installation automatically upgrades to webhooks

## Configuration

> **See `CONTRIBUTING.md` for complete environment variables reference.**

### GitHub App Manifest

Located at `github-app-manifest.json`. Key settings:

- `public: true` - Anyone can install
- `default_permissions`: read-only access to repos
- `default_events`: repo-level events only (NOT installation events)
- `redirect_url`: Required field (points to `/health`)

**Note**: Installation/repository events are app-level and automatically enabled.

## Implementation Status

### ✅ Completed

**Core Infrastructure:**

- GitHub App core with Octokit integration
- Webhook endpoint with signature verification
- Database schema with foreign key CASCADE
- CHECK constraints for data integrity
- Event processor routing to formatters
- Installation lifecycle management
- Idempotency tracking (database-backed)
- Type-safe handlers with consolidated types
- Dual-mode polling service (skips repos with app)

**User Experience:**

- Status command shows delivery mode per repo (⚡/⏱️)
- Private repo handling with OAuth validation
- Enhanced subscription messages with delivery mode info
- Installation notifications with automatic upgrade
- Case-insensitive unsubscribe
- Ephemeral OAuth URLs for security
- Installation suggestions with admin detection

**Documentation:**

- Comprehensive README reorganization
- New CONTRIBUTING.md with developer guide
- Complete environment variables documentation
- Condensed AGENTS.md reference

### 🚧 Remaining Work

**Improved Subscription UX (Priority 1):**

- Single OAuth flow - Create subscription during OAuth callback (users don't re-run command)
- Enhanced OAuth success page with installation countdown and auto-redirect
- Pre-select repository in GitHub App installation URL using `target_id` parameter

**Query Commands (Priority 2):**

- Additional commands: `/gh search`, `/gh_release list`
- Repository search functionality

**Event Organization (Priority 3):**

- Thread-based grouping for related events (PR + commits + CI)
- Event summaries and digests

## Testing Checklist

- [ ] Subscribe to public repo without app → polls successfully
- [ ] Subscribe to public repo with app → receives webhooks
- [ ] Subscribe to private repo without app → shows error, requires app
- [ ] Subscribe to private repo with app → receives webhooks
- [ ] Install app to repo → channel notified, mode switches
- [ ] Uninstall app from repo → channel notified, falls back to polling
- [ ] Webhook signature verification rejects invalid requests
- [ ] Idempotency prevents duplicate event processing
- [ ] Failed webhooks allow retry (not marked as processed)
- [ ] Old webhook deliveries cleaned up (lt() comparison works)

## Deployment Notes

**Platform**: Render (Web Service)

**Configuration**:

- Build: `bun install`
- Start: `bun run src/index.ts`
- Environment: Set all variables from `.env.sample`
- Persistent disk: `/opt/render/project/src` for SQLite

**Webhook URL**: Must be publicly accessible at `https://your-domain.com/github-webhook`

## Security Considerations

1. **Signature verification**: All GitHub webhooks verified via Octokit
2. **Raw body handling**: Webhook route registered before body-parsing middleware
3. **Idempotency**: Prevents replay attacks and duplicate processing
4. **Foreign key constraints**: Ensures data integrity
5. **CHECK constraints**: Validates data at database level

## Performance Characteristics

**Webhook mode**:

- Latency: < 1 second from GitHub event to Towns message
- Throughput: Limited by Octokit processing (no bottleneck observed)
- Database: O(1) idempotency check, O(1) installation lookup

**Polling mode**:

- Latency: Up to 5 minutes
- API usage: 1 request per repo per 5 minutes
- Database: O(n) where n = subscribed repos

**Cleanup**:

- Webhook deliveries: Periodic cleanup of records > 7 days old
- Uses `lt()` comparison (not `eq()`)

## Query Commands Private Repo Support

### Current Limitation

The `/gh_pr` and `/gh_issue` commands use a static bot-level GitHub token, which only works for public repositories. Private repos fail with 403/404 errors and generic error messages.

### Strategy

**OAuth-First Approach:** Use the user's personal GitHub OAuth token for private repo access.

The infrastructure already exists:

- `GitHubOAuthService` manages encrypted user tokens
- `/github subscribe` implements the same OAuth flow pattern
- `github_user_tokens` table stores tokens with AES-256-GCM encryption

### Implementation Summary

1. **Try bot token first** (works for public repos)
2. **On 403/404, check if user has OAuth token:**
   - Has token → retry with user's token
   - No token → show OAuth connection prompt
   - User token also fails → show access denied message
3. **Add error classification:**
   - 404 = repo not found
   - 403 without OAuth = show connection prompt
   - 403 with OAuth = user doesn't have access
   - 429 = rate limited
4. **Optional GitHub App fallback** for org-wide access without per-user OAuth

### Changes Required

- Modify `github-client` functions to accept optional user Octokit instance
- Update handlers to inject `GitHubOAuthService` dependency
- Add error classification helper
- Wire OAuth service to command handlers in `index.ts`

**Estimated effort:** 2-3 hours (infrastructure exists, just needs wiring)

## Future Improvements

1. **Repo-specific installation URLs**: Pre-select repository in installation flow
2. **Test webhook command**: `/github test owner/repo` to verify connectivity
3. **Health indicators**: Show delivery latency and last event timestamp
4. **Installation status command**: `/github app-status` to view all installations
5. **Webhook delivery monitoring**: Track success/failure rates
6. **Rate limit handling**: Graceful degradation if API limits hit
7. **Multi-region deployment**: Reduce latency for global users

## References

- GitHub App Documentation: https://docs.github.com/apps
- Octokit SDK: https://github.com/octokit
- Towns Protocol: https://towns.com
- Render Deployment: https://render.com
