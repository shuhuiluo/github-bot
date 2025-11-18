# GitHub App Implementation Plan

## Executive Summary

This document provides a complete implementation plan for adding GitHub App webhook support to the Towns GitHub bot,
while maintaining backward compatibility with the existing Events API polling (legacy) approach. The solution uses a *
*single JavaScript application** that handles both Towns and GitHub webhooks, optimized for deployment on **Render**.

## Part 1: Current Implementation - Events API (Legacy)

### Critical Limitations

Our investigation revealed that GitHub's Events API has fundamental limitations:

1. **Missing PR Close/Merge Events**: Out of 99 events analyzed, found 6 `PullRequestEvent` - ALL with
   `action:"opened"`, ZERO with `action:"closed"`
2. **Empty Commit Data**: All `PushEvent` instances have `commits:[]` (empty array)
3. **5-Minute Polling Delay**: Not real-time, impacts user experience
4. **Best-Effort Delivery**: No guarantees on event completeness

### Why This Happens

GitHub's Events API is designed for activity feeds, not reliable event delivery. When PRs are merged via squash/rebase
or auto-merge, the Events API often doesn't publish the close event, and push events arrive with empty commit arrays.

### What Works vs What Doesn't

**Works with Events API:**

- ✅ PR opens
- ✅ Issues opened/closed
- ✅ Reviews, Comments, Releases (if subscribed)
- ✅ Branch create/delete

**Doesn't Work:**

- ❌ PR merges (no closed events)
- ❌ Commit messages (empty arrays)
- ❌ Real-time notifications
- ❌ Guaranteed delivery

## Part 2: Solution - GitHub App Implementation

### Why GitHub App?

| Feature         | Events API (Legacy) | GitHub App (New)    |
|-----------------|---------------------|---------------------|
| PR merge events | ❌ Missing           | ✅ Complete          |
| Commit data     | ❌ Empty             | ✅ Full details      |
| Delivery        | ⚠️ Best effort      | ✅ Best-effort with retries |
| Latency         | ❌ 5-min polling     | ✅ Real-time         |
| Setup           | ✅ Easy (PAT)        | ✅ One-click install |
| Webhooks        | ❌ Manual per repo   | ✅ Automatic         |

### Architecture: Single App, Two Webhooks

The implementation adds GitHub webhook support to the **existing Towns bot application**:

```
┌────────────────────────────────────────────┐
│         Single Hono Application            │
├────────────────────────────────────────────┤
│                                            │
│  POST /webhook         ← Towns events      │
│  POST /github-webhook  ← GitHub App events │
│  GET /health          ← Health checks      │
│                                            │
│  • Same process                            │
│  • Same database (SQLite)                  │
│  • Same bot instance                       │
│  • Deployed on Render                      │
└────────────────────────────────────────────┘
```

**Key Points:**

- No separate services or containers needed
- Both webhook endpoints in the same `src/index.ts`
- Shared database and bot instance
- Single deployment on Render

## Part 3: Complete Implementation Specification

### 1. GitHub App Backend Code

#### 1.1 Core App Module (`src/github-app/app.ts`)

```typescript
import { App } from "@octokit/app";
import { Webhooks } from "@octokit/webhooks";

export class GitHubApp {
  private app: App;
  public webhooks: Webhooks; // Public for route registration in src/index.ts

  constructor() {
    this.app = new App({
      appId: process.env.GITHUB_APP_ID!,
      privateKey: Buffer.from(process.env.GITHUB_APP_PRIVATE_KEY_BASE64!, "base64").toString(),
      oauth: {
        clientId: process.env.GITHUB_APP_CLIENT_ID!,
        clientSecret: process.env.GITHUB_APP_CLIENT_SECRET!,
      },
    });

    this.webhooks = new Webhooks({
      secret: process.env.GITHUB_WEBHOOK_SECRET!,
    });

    this.registerWebhookHandlers();
  }

  // Get installation-scoped Octokit instance
  // Octokit internally handles JWT generation and installation token caching
  async getInstallationOctokit(installationId: number) {
    return await this.app.getInstallationOctokit(installationId);
  }

  private registerWebhookHandlers() {
    // Event handlers registration
    // Note: The handleXYZ methods below delegate to EventProcessor methods
    // for routing to formatters and sending to subscribed Towns channels
    this.webhooks.on("pull_request", this.handlePullRequest.bind(this));
    this.webhooks.on("push", this.handlePush.bind(this));
    this.webhooks.on("issues", this.handleIssues.bind(this));
    this.webhooks.on("issue_comment", this.handleIssueComment.bind(this));
    this.webhooks.on("release", this.handleRelease.bind(this));
    this.webhooks.on("workflow_run", this.handleWorkflowRun.bind(this));
    this.webhooks.on("installation", this.handleInstallation.bind(this));
    this.webhooks.on("installation_repositories", this.handleInstallationRepos.bind(this));
  }
}
```

#### 1.2 Webhook Processing with Idempotency (`src/github-app/webhook-processor.ts`)

```typescript
// Idempotency tracking to prevent duplicate processing
// NOTE: Production deployments MUST use the webhook_deliveries database table
// instead of in-memory Set to ensure idempotency across restarts and replicas
export class WebhookProcessor {
  private processedDeliveries: Set<string> = new Set();

  async isProcessed(deliveryId: string): Promise<boolean> {
    // In production, check database instead of in-memory Set
    return this.processedDeliveries.has(deliveryId);
  }

  async markProcessed(deliveryId: string): Promise<void> {
    this.processedDeliveries.add(deliveryId);
    // In production, store in webhook_deliveries table
  }
}
```

### 2. Raw Body Requirements for Webhook Verification

**IMPORTANT**: Webhook signature verification requires the **raw, unmodified request body**.

The webhook route is registered before any body-parsing middleware to guarantee access to the raw request body.

When using `@octokit/webhooks` with Hono or Express, you must:
1. Access the raw body buffer BEFORE any JSON parsing middleware
2. Pass the raw body string to `webhooks.verifyAndReceive()`
3. Never use parsed JSON for signature verification

```typescript
// Hono integration example showing raw body handling
app.post("/github-webhook", async (c) => {
  // Get raw body - CRITICAL for signature verification
  const body = await c.req.text();
  const signature = c.req.header("x-hub-signature-256");
  const event = c.req.header("x-github-event");
  const deliveryId = c.req.header("x-github-delivery");

  // Webhooks.verifyAndReceive handles signature verification internally
  try {
    await githubApp.webhooks.verifyAndReceive({
      id: deliveryId!,
      name: event as any,
      signature: signature!,
      payload: body, // Must be raw string, not parsed JSON
    });
    return c.json({ ok: true });
  } catch (error) {
    console.error("Webhook verification failed:", error);
    return c.json({ error: "Invalid signature" }, 401);
  }
});
```

### 3. Event Processing Pipeline

#### 3.1 Event Router (`src/github-app/event-processor.ts`)

```typescript
export class EventProcessor {
  async processWebhookEvent(event: any, eventType: string) {
    // Route to appropriate handler
    switch (eventType) {
      case "pull_request":
        return this.processPullRequest(event);
      case "push":
        return this.processPush(event);
      case "issues":
        return this.processIssues(event);
      case "issue_comment":
        return this.processIssueComment(event);
      case "release":
        return this.processRelease(event);
      case "workflow_run":
        return this.processWorkflowRun(event);
      case "installation":
        return this.processInstallation(event);
      default:
        console.log(`Unhandled event type: ${eventType}`);
    }
  }

  private async processPullRequest(event: any) {
    const { action, pull_request, repository, installation } = event;

    // Get subscribed channels for this repo
    const channels = await dbService.getRepoSubscribers(repository.full_name);

    // Filter by event preferences
    const interestedChannels = channels.filter(ch =>
      ch.eventTypes.includes("pr")
    );

    // Format message using existing formatter
    const message = formatWebhookPullRequest({
      action,
      pull_request,
      repository
    });

    // Send to all interested channels
    for (const channel of interestedChannels) {
      await bot.sendMessage(channel.channelId, message);
    }
  }

  private async processPush(event: any) {
    const { commits, repository, ref, installation } = event;

    // NOW WE HAVE FULL COMMIT DATA!
    const channels = await dbService.getRepoSubscribers(repository.full_name);
    const interestedChannels = channels.filter(ch =>
      ch.eventTypes.includes("commits")
    );

    const message = formatWebhookPush({
      commits, // Full commit details!
      repository,
      ref
    });

    for (const channel of interestedChannels) {
      await bot.sendMessage(channel.channelId, message);
    }
  }
}
```

### 4. Installation Lifecycle Management

#### 4.1 Installation Service (`src/github-app/installation-service.ts`)

```typescript
export class InstallationService {
  async handleInstallationCreated(event: any) {
    const { installation, repositories } = event;

    // Store installation in database
    await db.insert(githubInstallations).values({
      installationId: installation.id,
      accountLogin: installation.account.login,
      accountType: installation.account.type,
      installedAt: Date.now(),
      appSlug: installation.app_slug,
    });

    // Store repositories in normalized table
    for (const repo of repositories) {
      await db.insert(installationRepositories).values({
        installationId: installation.id,
        repoFullName: repo.full_name,
        addedAt: Date.now(),
      });
    }

    // Notify subscribed channels about new installation
    for (const repo of repositories) {
      const channels = await dbService.getRepoSubscribers(repo.full_name);
      for (const channel of channels) {
        await bot.sendMessage(
          channel.channelId,
          `✅ GitHub App installed for ${repo.full_name}! Switching to real-time webhook delivery.`
        );
      }
    }
  }

  async handleInstallationDeleted(event: any) {
    const { installation } = event;

    // Get repos before deletion
    const repos = await this.getInstallationRepos(installation.id);

    // Remove from database (cascade deletes repositories)
    await db.delete(githubInstallations)
      .where(eq(githubInstallations.installationId, installation.id));

    // Notify channels
    for (const repo of repos) {
      const channels = await dbService.getRepoSubscribers(repo);
      for (const channel of channels) {
        await bot.sendMessage(
          channel.channelId,
          `⚠️ GitHub App uninstalled for ${repo}. Falling back to polling mode.`
        );
      }
    }
  }

  async handleRepositoriesAdded(event: any) {
    const { installation, repositories_added } = event;

    // Add new repositories to normalized table
    for (const repo of repositories_added) {
      await db.insert(installationRepositories).values({
        installationId: installation.id,
        repoFullName: repo.full_name,
        addedAt: Date.now(),
      }).onConflictDoNothing();
    }
  }

  async handleRepositoriesRemoved(event: any) {
    const { installation, repositories_removed } = event;

    // Remove repositories from normalized table
    for (const repo of repositories_removed) {
      await db.delete(installationRepositories)
        .where(
          and(
            eq(installationRepositories.installationId, installation.id),
            eq(installationRepositories.repoFullName, repo.full_name)
          )
        );
    }
  }

  async getInstallationRepos(installationId: number): Promise<string[]> {
    const repos = await db.select()
      .from(installationRepositories)
      .where(eq(installationRepositories.installationId, installationId));

    return repos.map(r => r.repoFullName);
  }

  async isRepoInstalled(repo: string): Promise<number | null> {
    // Query normalized table with proper indexing
    const installation = await db.select()
      .from(installationRepositories)
      .where(eq(installationRepositories.repoFullName, repo))
      .limit(1);

    return installation[0]?.installationId || null;
  }
}
```

### 5. Subscription System Integration

#### 5.1 Enhanced Subscription Handler (`src/handlers/github-subscription-handler.ts`)

```typescript
// Add to existing handler
async function handleGithubSubscribe(handler: BotHandler, event: any) {
  const { channelId, repo, eventTypes } = event;

  // Check if GitHub App is installed
  const installationId = await installationService.isRepoInstalled(repo);

  if (!installationId) {
    // Generate installation URL
    const installUrl = `https://github.com/apps/${process.env.GITHUB_APP_SLUG}/installations/new?` +
      `suggested_target_id=${repo.split('/')[0]}&repository_ids=${await getRepoId(repo)}`;

    await handler.sendMessage(
      channelId,
      `⚠️ GitHub App not installed for ${repo}.\n\n` +
      `For real-time events and full commit data, install the GitHub App:\n${installUrl}\n\n` +
      `Subscribing with legacy polling mode (5-minute delay, limited events).`
    );
  } else {
    await handler.sendMessage(
      channelId,
      `✅ Subscribed to ${repo} with real-time webhook delivery!`
    );
  }

  // Store subscription (works for both modes)
  await dbService.subscribe(channelId, repo, eventTypes);
}
```

### 6. Dual-Mode Service

#### 6.1 Hybrid Polling/Webhook Service (`src/services/dual-mode-service.ts`)

```typescript
export class DualModeService {
  async processRepository(repo: string) {
    // Check if GitHub App is installed
    const installationId = await installationService.isRepoInstalled(repo);

    if (installationId) {
      // Webhook mode - do nothing (webhooks handle automatically)
      console.log(`${repo}: Using GitHub App webhooks (real-time)`);
      return;
    }

    // Legacy polling mode
    console.log(`${repo}: Using Events API polling (5-min delay)`);
    await this.pollRepository(repo);
  }

  private async pollRepository(repo: string) {
    // Existing polling logic from polling-service.ts
    const events = await fetchRepoEvents(repo);
    // ... process events
  }
}
```

### 7. Database Schema

```sql
-- Add to existing schema
CREATE TABLE IF NOT EXISTS github_installations
(
    installation_id INTEGER PRIMARY KEY,
    account_login TEXT NOT NULL,
    account_type TEXT NOT NULL CHECK (account_type IN ('Organization', 'User')),
    installed_at INTEGER NOT NULL,
    suspended_at INTEGER,
    app_slug TEXT NOT NULL DEFAULT 'towns-github-bot'
);

-- Normalized repository table - NO JSON columns
CREATE TABLE IF NOT EXISTS installation_repositories
(
    installation_id INTEGER NOT NULL,
    repo_full_name TEXT NOT NULL,
    added_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
    PRIMARY KEY (installation_id, repo_full_name),
    FOREIGN KEY (installation_id) REFERENCES github_installations(installation_id) ON DELETE CASCADE
);

-- Webhook deliveries with proper idempotency key
CREATE TABLE IF NOT EXISTS webhook_deliveries
(
    delivery_id TEXT PRIMARY KEY,  -- X-GitHub-Delivery header value
    installation_id INTEGER,
    event_type TEXT NOT NULL,
    delivered_at INTEGER NOT NULL,
    status TEXT DEFAULT 'pending',
    error TEXT,
    retry_count INTEGER DEFAULT 0
);

-- Indexes for efficient queries
CREATE INDEX idx_installation_repos_by_name ON installation_repositories(repo_full_name);
CREATE INDEX idx_installation_repos_by_install ON installation_repositories(installation_id);
CREATE INDEX idx_deliveries_status ON webhook_deliveries(status, delivered_at);
```

### 8. Webhook Server Implementation

#### 8.1 Hono Integration (`src/index.ts` update)

```typescript
import { GitHubApp } from "./github-app/app";
import { WebhookProcessor } from "./github-app/webhook-processor";

const githubApp = new GitHubApp();
const webhookProcessor = new WebhookProcessor();

// Add GitHub webhook endpoint
// IMPORTANT: Do not use body parsing middleware before this endpoint
app.post("/github-webhook", async (c) => {
  // Get headers for webhook processing
  const deliveryId = c.req.header("x-github-delivery");
  const signature = c.req.header("x-hub-signature-256");
  const event = c.req.header("x-github-event");

  if (!deliveryId || !signature || !event) {
    return c.json({ error: "Missing required headers" }, 400);
  }

  // Check idempotency
  if (await webhookProcessor.isProcessed(deliveryId)) {
    return c.json({ message: "Already processed" }, 200);
  }

  try {
    // Get raw body for signature verification
    const body = await c.req.text();

    // Use Octokit's built-in verification and processing
    await githubApp.webhooks.verifyAndReceive({
      id: deliveryId,
      name: event as any,
      signature: signature,
      payload: body, // Must be raw string, not parsed JSON
    });

    // Mark as processed for idempotency
    await webhookProcessor.markProcessed(deliveryId);

    return c.json({ ok: true });
  } catch (error) {
    console.error("Webhook error:", error);
    if (error.message?.includes("signature")) {
      return c.json({ error: "Invalid signature" }, 401);
    }
    return c.json({ error: "Processing failed" }, 500);
  }
});

// Health check with GitHub App status
app.get("/health", async (c) => {
  const appInstallations = await db.select()
    .from(githubInstallations)
    .limit(1);

  return c.json({
    status: "healthy",
    githubApp: {
      configured: !!process.env.GITHUB_APP_ID,
      installations: appInstallations.length
    },
    polling: {
      active: pollingService.isRunning()
    }
  });
});
```

### 9. Configuration Files

#### 9.1 Environment Variables (`.env.production`)

```bash
# GitHub App Configuration
GITHUB_APP_ID=YOUR_APP_ID
GITHUB_APP_PRIVATE_KEY_BASE64=your-base64-encoded-private-key-here
GITHUB_APP_CLIENT_ID=YOUR_CLIENT_ID
GITHUB_APP_CLIENT_SECRET=your-client-secret-here
GITHUB_APP_SLUG=your-app-slug
GITHUB_WEBHOOK_SECRET=your-webhook-secret-here

# Legacy (keep for backward compatibility)
GITHUB_TOKEN=YOUR_LEGACY_TOKEN

# Towns Bot Configuration
APP_PRIVATE_DATA=your-app-private-data-here
JWT_SECRET=your-jwt-secret-here

# Application
PUBLIC_URL=https://bot.example.com
PORT=5123
NODE_ENV=production
```

#### 9.2 GitHub App Manifest (`github-app-manifest.json`)

```json
{
  "name": "Towns GitHub Bot",
  "url": "https://github.com/HereNotThere/bot-github",
  "hook_attributes": {
    "url": "https://bot.example.com/github-webhook",
    "active": true
  },
  "redirect_url": "https://bot.example.com/github-app/callback",
  "callback_urls": [
    "https://bot.example.com/github-app/callback"
  ],
  "setup_url": "https://bot.example.com/github-app/setup",
  "description": "Real-time GitHub notifications for Towns Protocol",
  "public": false,
  "default_permissions": {
    "contents": "read",
    "issues": "read",
    "pull_requests": "read",
    "metadata": "read",
    "actions": "read"
  },
  "default_events": [
    "pull_request",
    "push",
    "issues",
    "issue_comment",
    "release",
    "workflow_run",
    "pull_request_review",
    "pull_request_review_comment",
    "create",
    "delete",
    "installation",
    "installation_repositories"
  ]
}
```

### 10. Deployment Configuration

#### 10.1 Render Deployment (Recommended)

**Render Web Service Settings:**

```yaml
# render.yaml (optional - for Infrastructure as Code)
services:
  - type: web
    name: towns-github-bot
    runtime: node
    buildCommand: bun install
    startCommand: bun run src/index.ts
    envVars:
      - key: NODE_ENV
        value: production
      - key: PORT
        value: 5123
      # Add other env vars in Render dashboard
```

**Manual Setup in Render Dashboard:**

1. **Build Command**: `bun install`
2. **Start Command**: `bun run src/index.ts`
3. **Environment Variables**: Add all from `.env.production` above
4. **Persistent Disk**: Mount at `/opt/render/project/src` for SQLite database

**Key Advantages:**

- No Docker required
- Automatic HTTPS
- Built-in health checks
- Environment variable management
- Persistent disk for SQLite

#### 10.2 Docker Configuration (Optional - for other platforms)

Docker is **NOT required for Render**, but provided here for users on other platforms:

<details>
<summary>Docker configuration (click to expand)</summary>

```dockerfile
# Dockerfile
FROM oven/bun:1-alpine
WORKDIR /app
COPY package.json bun.lockb ./
RUN bun install --frozen-lockfile
COPY . .
EXPOSE 5123
CMD ["bun", "run", "src/index.ts"]
```

```yaml
# docker-compose.yml
version: '3.8'
services:
  bot:
    build: .
    ports:
      - "5123:5123"
    env_file: .env.production
    volumes:
      - ./github-bot.db:/app/github-bot.db
    restart: unless-stopped
```

</details>

### 11. Migration Path

#### Phase 1: Deploy GitHub App (Week 1)

1. Create GitHub App using manifest
2. Deploy webhook endpoint
3. Test with single repository
4. Monitor webhook delivery

#### Phase 2: Dual-Mode Operation (Week 2)

1. Update subscription handler with installation detection
2. Deploy dual-mode service
3. Existing subscriptions continue with polling
4. New installations use webhooks

#### Phase 3: User Migration (Week 3)

1. Add `/github install` command
2. Notify users about benefits
3. Track adoption metrics
4. Phase out polling gradually

## Part 4: Implementation Checklist

### Required Components (All Must Be Implemented)

- [ ] **GitHub App Backend** - Complete webhook server with all event handlers
- [ ] **Authentication Logic** - Use Octokit's built-in JWT/installation-token handling
- [ ] **Octokit Integration** - App-authenticated API calls
- [ ] **Installation Lifecycle** - Handle install/uninstall/permission changes
- [ ] **Subscription System** - Map repos to channels with event filtering
- [ ] **Event Processing** - Route all event types to formatters
- [ ] **Multi-tenancy** - Data isolation per installation
- [ ] **Security** - Signature verification, idempotency, rate limiting
- [ ] **Deployment Config** - Environment variables, manifests, Render configuration
- [ ] **Migration Support** - Dual-mode operation for backward compatibility

### Success Criteria

1. **Full Event Coverage**: All PR events including merges with complete data
2. **Real-time Delivery**: Events delivered in <1 second
3. **Zero Manual Setup**: Users install app, webhooks work automatically
4. **Backward Compatible**: Existing polling subscriptions continue working
5. **Production Ready**: Error handling, retries, monitoring, logging

## Part 5: Testing Strategy

### Local Development

```bash
# 1. Create test GitHub App
# 2. Use ngrok for webhook tunnel
ngrok http 5123

# 3. Update GitHub App webhook URL to ngrok URL
# 4. Install app on test repository
# 5. Trigger events and verify delivery
```

### Integration Testing

```typescript
// Test webhook signature verification
describe("Webhook Security", () => {
  test("rejects invalid signature", async () => {
    const response = await app.request("/github-webhook", {
      method: "POST",
      headers: {
        "x-hub-signature-256": "invalid",
        "x-github-event": "push"
      },
      body: JSON.stringify({ test: true })
    });
    expect(response.status).toBe(401);
  });

  test("accepts valid signature", async () => {
    // Test with valid HMAC signature
  });
});

// Test installation lifecycle
describe("Installation Management", () => {
  test("stores new installation", async () => {
    // Simulate installation.created event
  });

  test("handles repository changes", async () => {
    // Simulate installation_repositories event
  });
});
```

## Part 6: Monitoring and Operations

### Key Metrics

1. **Webhook Delivery Rate**: Successfully processed / total received
2. **Event Latency**: Time from GitHub event to Towns message
3. **Installation Count**: Active GitHub App installations
4. **Error Rate**: Failed webhooks, token refresh failures
5. **Legacy vs Webhook**: Repos using polling vs webhooks

### Operational Procedures

1. **Private Key Rotation**:
    - Generate new private key in GitHub App settings
    - Update `GITHUB_APP_PRIVATE_KEY_BASE64` environment variable
    - Restart service
    - No downtime required

2. **Webhook Secret Rotation**:
    - Update secret in GitHub App settings
    - Update `GITHUB_WEBHOOK_SECRET` environment variable
    - Deploy with dual-secret support during transition
    - Remove old secret after confirmation

3. **Debugging Webhook Issues**:
    - Check `/health` endpoint for app status
    - Review `webhook_deliveries` table for failures
    - Use GitHub's webhook delivery UI for replay
    - Check installation permissions

## Summary

This document provides a complete, production-ready implementation plan for migrating from the limited GitHub Events API
to a full GitHub App integration. The solution maintains backward compatibility while providing real-time, complete
event data for all GitHub activities.

**Current State**: Events API with critical limitations (legacy)
**Target State**: GitHub App with automatic webhooks (production-ready)
**Migration**: Dual-mode operation with gradual user migration
**Timeline**: 3 weeks from start to full production deployment
