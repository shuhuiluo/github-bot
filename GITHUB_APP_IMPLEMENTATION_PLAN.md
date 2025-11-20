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

### Public Repositories

When a user runs `/github subscribe owner/repo` in a Towns channel:

1. **Require GitHub OAuth linking**
   - Check if the Towns user has linked their GitHub account
   - If not linked, respond with "Connect your GitHub account" prompt and OAuth URL

2. **Resolve and validate the repository**
   - Call `GET /repos/{owner}/{repo}` using the user's OAuth token
   - If 404/403 response → treat as "repo not found or no access" and fail
   - Extract from response:
     - `repo_full_name` (normalized owner/repo)
     - `private` flag (true/false)
     - `owner.login` (account name)
     - `owner.type` (`User` or `Organization`)
     - `owner.id` (numeric ID for installation links)

3. **Determine delivery mode**
   - If `private == true`, follow Private Repositories flow instead
   - If `private == false` (public repo):
     - Query `installation_repositories` via `InstallationService` to check if any installation covers this `repo_full_name`
     - If covered → set `delivery_mode = 'webhook'` and store the `installation_id`
     - If not covered → set `delivery_mode = 'polling'` and `installation_id = NULL`

4. **Persist subscription**
   - Insert into `github_subscriptions` table with:
     - `space_id`, `channel_id` from the Towns event
     - `repo_full_name` (validated from GitHub)
     - `delivery_mode` ('webhook' or 'polling')
     - `is_private = 0`
     - `created_by_towns_user_id` (Towns user ID)
     - `created_by_github_login` (GitHub username from OAuth)
     - `installation_id` (if webhook mode) or NULL (if polling mode)
     - `created_at`, `updated_at` timestamps

5. **User messaging**
   - Success message: `"Subscribed owner/repo to this channel."`
   - Do NOT expose delivery mode (webhook vs polling) in the message
   - If `delivery_mode = 'polling'`, append installation suggestion:
     - Generate URL: `https://github.com/apps/<APP_SLUG>/installations/new/permissions?target_id=<owner.id>`
     - Use smart heuristics to determine appropriate messaging:
       - **Personal repo** (`owner.type == 'User' && owner.login == github_user.login`):
         - "You can install the GitHub App for real-time delivery: [Install]"
       - **Org repo** (check `GET /user/memberships/orgs/{owner.login}` for `role == 'admin'`):
         - If admin: "You can install the GitHub App for real-time delivery: [Install]"
         - If not admin: "Ask an org admin to install the GitHub App for real-time delivery: [Install]"

### Private Repositories

For private repositories:

1. **Require GitHub OAuth linking**
   - Same as public repositories flow

2. **Validate access**
   - Call `GET /repos/{owner}/{repo}` using the user's OAuth token
   - If user has read access, GitHub returns 200 (works for both user-owned and org-owned private repos)
   - If no access (404/403), return clear error:
     - `"You don't have access to this repository as <github_login>."`

3. **Require GitHub App installation**
   - Check `installation_repositories` via `InstallationService` to see if any installation covers this repo
   - If repo is NOT covered by any installation:
     - **Do NOT create a subscription**
     - Return installation URL with error message:
       - `"This private repository requires the GitHub App to be installed. Install here: https://github.com/apps/<APP_SLUG>/installations/new/permissions?target_id=<owner.id>"`
   - Note: We do NOT check all channel members' GitHub permissions (intentionally using Slack-style wide model - responsibility lies with the user configuring the subscription)

4. **Persist subscription**
   - If the repo IS covered by an installation:
     - Insert into `github_subscriptions` table with:
       - `delivery_mode = 'webhook'` (private repos MUST use webhooks)
       - `is_private = 1`
       - `installation_id` set to the covering installation ID
       - All other columns same as public repo flow

5. **User messaging**
   - Success: `"Subscribed private repo owner/repo to this channel."`
   - Optionally add note: `"Private repo events will be visible to all channel members."`

### Upgrading Subscriptions After Installation

When the GitHub App is newly installed on an account or additional repos are added:

1. **Installation event processing**
   - `InstallationService` processes `installation` and `installation_repositories` webhook events
   - Updates `github_installations` and `installation_repositories` tables

2. **Find affected subscriptions**
   - After processing an `installation_repositories` `"added"` event for a `repo_full_name`:
     - Query `github_subscriptions` where:
       - `repo_full_name` matches the newly added repository
       - `delivery_mode = 'polling'` (currently using fallback mode)

3. **Upgrade to webhook mode**
   - For each matching subscription:
     - Update the row to:
       - `delivery_mode = 'webhook'`
       - `installation_id = <current installation_id>`
       - `updated_at = <current timestamp>`

4. **Notify channels**
   - Send a message to each affected channel:
     - `"🔄 Upgraded owner/repo to real-time webhook delivery!"`
   - This provides immediate feedback that the installation was successful

## Configuration

### Environment Variables

```bash
# GitHub App (required for webhooks)
GITHUB_APP_ID=123456
GITHUB_APP_PRIVATE_KEY_BASE64=<base64-encoded-pem>
GITHUB_APP_CLIENT_ID=Iv1.abc123
GITHUB_APP_CLIENT_SECRET=<secret>
GITHUB_APP_SLUG=towns-github-bot
GITHUB_WEBHOOK_SECRET=<random-string>

# Legacy polling (optional fallback)
GITHUB_TOKEN=ghp_xxx

# Towns Bot
APP_PRIVATE_DATA=<base64-encoded>
JWT_SECRET=<secret>
```

### GitHub App Manifest

Located at `github-app-manifest.json`. Key settings:

- `public: true` - Anyone can install
- `default_permissions`: read-only access to repos
- `default_events`: repo-level events only (NOT installation events)
- `redirect_url`: Required field (points to `/health`)

**Note**: Installation/repository events are app-level and automatically enabled.

## Implementation Status

### ✅ Completed

- GitHub App core with Octokit integration
- Webhook endpoint with signature verification
- Database schema with foreign key CASCADE
- CHECK constraints for data integrity
- Event processor routing to formatters
- Installation lifecycle management
- Idempotency tracking (database-backed)
- Type-safe handlers with consolidated types
- Dual-mode polling service (skips repos with app)

### ⚠️ Known Issues

1. **Help message outdated**: Says "checked every 5 min" without mentioning app
2. **Status command incomplete**: Doesn't show per-repo delivery mode
3. **No private repo detection**: Allows subscription to inaccessible repos
4. **Generic installation URL**: Doesn't pre-select specific repository
5. **No installation status command**: Users can't see which repos have app

## Remaining Work

### Priority 1: User Experience

1. **Update `/help` command**
   - Mention GitHub App option
   - Explain real-time vs polling

2. **Fix `/github status` command**
   - Show delivery mode per repo (⚡ Real-time or ⏱️ Polling)
   - Count and display breakdown
   - Prompt to install app if repos are polling

3. **Private repo handling**
   - Check repo accessibility before subscribing
   - Block subscription to private repos without app
   - Clear error message with installation instructions

### Priority 2: Quality of Life

4. **Enhanced subscription messages**
   - Better formatting with emojis
   - Clear explanation of what happens next
   - Expected delay for first event

5. **Installation notifications**
   - More prominent formatting
   - List which events are now real-time
   - Suggest verifying with `/github status`

### Priority 3: Documentation

6. **README updates**
   - Add GitHub App installation section
   - Explain dual-mode operation
   - Document private repo requirements

7. **.env.sample improvements**
   - Better explanations of each variable
   - Link to GitHub App setup guide
   - Mark required vs optional variables

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
