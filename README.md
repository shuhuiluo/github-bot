# GitHub Bot for Towns

A comprehensive GitHub integration bot for Towns Protocol, similar to Slack's GitHub app.

## What This Bot Does

This bot brings GitHub notifications and interactions directly into your Towns channels using OAuth and GitHub App integration:

### 🔔 Real-Time Notifications

Receive instant webhook notifications for:

- **Pull Requests** - Opened, closed, merged
- **Issues** - Opened, closed
- **Pushes** - Commits to branches with details
- **Releases** - New releases published
- **CI/CD** - Workflow run status (success/failure)
- **Comments** - New comments on issues/PRs
- **Reviews** - PR review submissions
- **Branches** - Branch/tag creation and deletion
- **Forks** - Repository forks
- **Stars** - Repository stars (watch events)

### 💬 Interactive Commands

Query and subscribe to repositories using slash commands. See [Usage](#usage) section for detailed examples.

## Features

- **GitHub App Integration** - Official GitHub App with OAuth authentication
- **Dual Delivery Modes** - Real-time webhooks OR 5-minute polling fallback
- **OAuth-First Architecture** - Users authenticate with their GitHub account
- **Private Repository Support** - Access private repos with user permissions
- **Smart Delivery** - Automatic webhook mode when GitHub App is installed
- **Event Filtering** - Subscribe to specific event types (pr, issues, commits, etc.)
- **Channel-Based Subscriptions** - Each channel has independent subscriptions
- **Persistent Storage** - PostgreSQL database with Drizzle ORM

## Setup

### 1. Prerequisites

- Bun installed (`curl -fsSL https://bun.sh/install | bash`)
- PostgreSQL database (local Docker or hosted on Render/Neon)
- Towns bot created via Developer Portal (app.towns.com/developer)
- GitHub App created (optional - enables real-time webhooks)

### 2. Local Development Setup

1. **Clone and install dependencies**

   ```bash
   git clone <your-repo>
   cd github-bot
   bun install
   ```

2. **Configure environment variables**

   ```bash
   cp .env.sample .env
   ```

   Edit `.env` with your values:

   ```dotenv
   # Required
   APP_PRIVATE_DATA=<from Towns Developer Portal>
   JWT_SECRET=<from Towns Developer Portal>
   DATABASE_URL=postgresql://user:pass@host:5432/github-bot
   PUBLIC_URL=https://your-bot.onrender.com
   ```

   > **Note:** See `CONTRIBUTING.md` for all configuration options including GitHub App setup, database options, and development settings.

3. **Start Postgres locally for development**

   You can run Postgres in Docker with a single command:

   ```bash
   docker run --rm --name github-bot-db \
     -e POSTGRES_USER=postgres \
     -e POSTGRES_PASSWORD=postgres \
     -e POSTGRES_DB=github-bot \
     -p 5432:5432 \
     postgres:18
   ```

   Then point your `.env` at the container:

   ```dotenv
   DATABASE_URL=postgresql://postgres:postgres@localhost:5432/github-bot
   DATABASE_SSL=false
   ```

4. **Database migrations** (automatic on startup)

   Migrations run automatically when the bot starts. The database schema is created on first run.

   Manual migration commands (if needed):

   ```bash
   bun run db:generate   # Generate new migrations from schema changes
   bun run db:migrate    # Run pending migrations
   bun run db:push       # Push schema directly (dev only)
   ```

5. **Run the bot locally**

   ```bash
   bun run dev
   ```

6. **Expose webhook with ngrok** (for testing)

   ```bash
   ngrok http 5123
   ```

7. **Update webhook URL in Developer Portal**
   - Set to: `https://your-ngrok-url.ngrok-free.app/webhook`

## GitHub App Setup

The bot supports two delivery modes:

- **Polling mode** - Checks every 5 minutes (default, no setup required)
- **Webhook mode** - Instant notifications (requires GitHub App installation)

> **For GitHub App setup:** See `CONTRIBUTING.md` for detailed instructions on creating and configuring a GitHub App.

## Usage

### Subscription Commands

```bash
# Subscribe to repository (first time: OAuth authentication required)
/github subscribe owner/repo

# Subscribe with specific event types
/github subscribe owner/repo --events pr,issues,commits

# View subscriptions
/github status

# Unsubscribe
/github unsubscribe owner/repo
```

**Event types:** `pr`, `issues`, `commits`, `releases`, `ci`, `comments`, `reviews`, `branches`, `forks`, `stars`, `all`

**Delivery modes:**

- With GitHub App installed: Real-time webhooks (instant)
- Without GitHub App: Polling mode (5-minute intervals)

### Query Commands

```bash
# Show single PR or issue
/gh_pr owner/repo 123         # Summary view
/gh_pr owner/repo #123 --full # Full description
/gh_issue owner/repo 456      # Summary view
/gh_issue owner/repo #456 --full # Full description

# List recent PRs or issues
/gh_pr list owner/repo 10                  # 10 most recent
/gh_pr list owner/repo 5 --state=open      # Filter by state
/gh_pr list owner/repo 10 --author=user    # Filter by author

/gh_issue list owner/repo 10               # 10 most recent
/gh_issue list owner/repo 5 --state=closed # Filter by state
/gh_issue list owner/repo 10 --creator=user # Filter by creator
```

**Filters:** `--state=open|closed|merged|all`, `--author=username`, `--creator=username`

## Supported GitHub Events

### Webhook Events (Real-Time)

- `pull_request` - Opened, closed, merged
- `issues` - Opened, closed
- `push` - Commits to branches
- `release` - Published
- `workflow_run` - CI/CD status
- `issue_comment` - New comments
- `pull_request_review` - PR reviews
- `create` / `delete` - Branch/tag creation and deletion
- `fork` - Repository forks
- `watch` - Repository stars

### Polling Events (5-Minute Intervals)

All webhook events above, plus:

- `pull_request_review_comment` - Review comments

## Production Deployment

1. **Push to GitHub**
2. **Deploy to Render/Railway/Fly.io**
3. **Set environment variables** in hosting platform
4. **Update webhook URL** in Developer Portal
5. **Test with `/help` command**

## Current Limitations

- **No interactive actions** - Towns Protocol doesn't support buttons/forms yet
- **No threaded conversations** - All notifications sent as top-level messages
- **5-minute polling delay** - Without GitHub App, events have 5-minute latency

## Future Enhancements

### Completed

- [x] Automatic subscription upgrade when GitHub App is installed
- [x] Private repo support for `/gh_pr` and `/gh_issue` commands

### Subscription & UX

- [ ] Improved subscription UX - Single OAuth flow with immediate subscription creation
- [ ] Enhanced OAuth success page - Installation countdown and auto-redirect
- [ ] Granular unsubscribe - Unsubscribe from specific event types without removing entire repo subscription
- [ ] Subscription management - Update event filters for existing subscriptions

### Event Organization

- [ ] Thread-based event grouping - Group related events (PR + commits + CI) in threads to reduce channel noise
- [ ] Event summaries - Digest multiple events into single update message

### Commands & Queries

- [ ] More slash commands (`/gh search`, `/gh_release list`)
- [ ] PR/Issue status commands (`/gh_pr merge`, `/gh_issue close`)
- [ ] Advanced filtering (labels, assignees, milestones)

### Automation

- [ ] Scheduled digests (daily/weekly summaries)
