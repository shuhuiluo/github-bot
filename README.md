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

### 💬 Slash Commands

**Subscription Management:**

- `/github subscribe owner/repo` - Subscribe channel to repository events
- `/github unsubscribe owner/repo` - Unsubscribe from a repository
- `/github status` - Show current subscriptions

**Query Commands:**

- `/gh_pr owner/repo #123 [--full]` - Display single pull request details
- `/gh_pr list owner/repo [count] [--state=...] [--author=...]` - List recent pull requests
- `/gh_issue owner/repo #123 [--full]` - Display single issue details
- `/gh_issue list owner/repo [count] [--state=...] [--creator=...]` - List recent issues

**Filters:**

- `--state=open|closed|merged|all` - Filter by state (merged only for PRs)
- `--author=username` - Filter PRs by author
- `--creator=username` - Filter issues by creator

**Other:**

- `/help` - Show all available commands

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
   APP_PRIVATE_DATA=<from Towns Developer Portal>
   JWT_SECRET=<from Towns Developer Portal>
   PORT=5123

   # Database (Required)
   DATABASE_URL=postgresql://user:pass@host:5432/github-bot
   DATABASE_SSL=true
   DATABASE_POOL_SIZE=5
   DATABASE_CA_CERT_PATH=/path/to/ca.pem   # optional - custom CA bundle
   DEV_DISABLE_SSL_VALIDATION=false        # only for local dev if needed

   # GitHub App (Optional - enables real-time webhooks)
   GITHUB_APP_ID=123456
   GITHUB_APP_PRIVATE_KEY=<base64 encoded private key>
   GITHUB_CLIENT_ID=Iv1.abc123
   GITHUB_CLIENT_SECRET=<your client secret>
   GITHUB_WEBHOOK_SECRET=<random secret for webhook security>

   # Public URL (Required for OAuth callbacks)
   PUBLIC_URL=https://your-bot.onrender.com
   ```

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

## Environment Variables

### Required

- `APP_PRIVATE_DATA` - Your Towns bot private key (from Developer Portal)
- `JWT_SECRET` - JWT secret for webhook authentication (from Developer Portal)
- `DATABASE_URL` - PostgreSQL connection string
- `PUBLIC_URL` - Your bot's public URL (required for OAuth callbacks)

### Optional (Recommended for Real-Time Webhooks)

- `GITHUB_APP_ID` - GitHub App ID
- `GITHUB_APP_PRIVATE_KEY` - Base64-encoded GitHub App private key
- `GITHUB_CLIENT_ID` - GitHub OAuth App client ID
- `GITHUB_CLIENT_SECRET` - GitHub OAuth App client secret
- `GITHUB_WEBHOOK_SECRET` - Secret for webhook signature verification
- `PORT` - Port to run on (default: 3000)

### Database Options

- `DATABASE_SSL` - Enable SSL for database connection (default: false)
- `DATABASE_POOL_SIZE` - Connection pool size (default: 10)
- `DATABASE_CA_CERT_PATH` - Path to custom CA certificate
- `DEV_DISABLE_SSL_VALIDATION` - Disable SSL validation (development only)

## GitHub App Setup (Optional)

Without a GitHub App, the bot uses **polling mode** (checks every 5 minutes).
With a GitHub App, the bot uses **webhook mode** (instant notifications).

### Quick Setup

1. Visit `https://github.com/settings/apps/new`
2. Fill in basic info:
   - Name: `Towns GitHub Bot`
   - Homepage URL: `https://github.com/your-org/towns-github-bot`
   - Webhook URL: `https://your-bot.onrender.com/github-webhook`
   - Webhook Secret: Generate a random secret
3. Permissions:
   - Repository: Contents (read), Issues (read), Pull requests (read), Metadata (read)
   - Organization: Members (read)
4. Subscribe to events: pull_request, push, issues, release, workflow_run, issue_comment, pull_request_review, create, delete, fork, watch
5. Create the app and note down:
   - App ID
   - Client ID
   - Client Secret
   - Generate and download private key
6. Base64 encode the private key: `base64 -i your-key.pem`
7. Add all values to your `.env` file

## Usage

### Subscribe to GitHub Repository

1. **First-time OAuth** - In a Towns channel, run:

   ```
   /github subscribe owner/repo
   ```

2. **Authenticate** - Click the OAuth link to connect your GitHub account

3. **Start receiving notifications!**
   - **With GitHub App installed**: Real-time webhooks (instant)
   - **Without GitHub App**: Polling mode (every 5 minutes)

4. **Optional: Install GitHub App** for real-time notifications:
   - Bot will provide an install link if not already installed
   - Install on your personal account or organization
   - Repos with the app installed automatically get webhook delivery

### Filter Events

Subscribe to specific event types:

```
/github subscribe owner/repo --events pr,issues,commits
```

Available event types: `pr`, `issues`, `commits`, `releases`, `ci`, `comments`, `reviews`, `branches`, `forks`, `stars`

### Query GitHub Data

**Show single PR or issue:**

```
/gh_pr facebook/react 123         # Show PR details (summary)
/gh_pr facebook/react #123 --full # Show PR with full description
/gh_issue facebook/react 456      # Show issue details (summary)
/gh_issue facebook/react #456 --full # Show issue with full description
```

**List recent PRs or issues:**

```
/gh_pr list facebook/react 10                    # List 10 most recent PRs
/gh_pr list facebook/react 5 --state=open        # List 5 open PRs
/gh_pr list facebook/react 10 --author=gaearon   # List PRs by author

/gh_issue list facebook/react 10                 # List 10 most recent issues
/gh_issue list facebook/react 5 --state=closed   # List 5 closed issues
/gh_issue list facebook/react 10 --creator=dan   # List issues by creator
```

**Check subscriptions:**

```
/github status                    # Show current subscriptions
```

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

- [ ] Automatic subscription upgrade when GitHub App is installed
- [ ] Private repo support for `/gh_pr` and `/gh_issue` commands
- [ ] More slash commands (`/gh search`, `/gh_release list`)
- [ ] Scheduled digests (daily/weekly summaries)
- [ ] Thread organization for related webhook events
- [ ] Advanced filtering (labels, assignees, milestones)
- [ ] PR/Issue status commands (`/gh_pr merge`, `/gh_issue close`)
