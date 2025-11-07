# GitHub Bot for Towns

A comprehensive GitHub integration bot for Towns Protocol, similar to Slack's GitHub app.

## What This Bot Does

This bot brings GitHub notifications and interactions directly into your Towns channels:

### 🔔 Webhook Notifications
Receive real-time notifications for:
- **Pull Requests** - Opened, closed, merged
- **Issues** - Opened, closed, labeled
- **Pushes** - Commits to branches with details
- **Releases** - New releases published
- **CI/CD** - Workflow run status (success/failure)
- **Comments** - New comments on issues/PRs
- **Reviews** - PR review submissions

### 💬 Slash Commands
- `/github subscribe owner/repo` - Subscribe channel to repository events
- `/github unsubscribe` - Unsubscribe from all repositories
- `/github status` - Show current subscriptions
- `/gh-pr owner/repo #123` - Display pull request details
- `/gh-issue owner/repo #123` - Display issue details
- `/help` - Show all available commands
- `/time` - Get current time

### 🔗 Auto-Unfurl (Bonus Feature)
Paste GitHub URLs and the bot automatically expands them with details:
- Pull request links
- Issue links

## Features Demonstrated

- External webhook integration (GitHub → Towns)
- Subscription management (channel-based)
- GitHub API integration (read-only)
- Webhook signature verification
- Multi-event formatters
- URL pattern detection and auto-unfurling
- Real-time notifications to multiple channels

## Setup

### 1. Prerequisites
- Bun installed (`curl -fsSL https://bun.sh/install | bash`)
- GitHub account (for creating Personal Access Token)
- Towns bot created via Developer Portal (app.towns.com/developer)

### 2. Local Development Setup

1. **Clone and install dependencies**
   ```bash
   git clone <your-repo>
   cd bet-bot
   bun install
   ```

2. **Configure environment variables**
   ```bash
   cp .env.sample .env
   ```

   Edit `.env` with your values:
   ```
   APP_PRIVATE_DATA=<from Towns Developer Portal>
   JWT_SECRET=<from Towns Developer Portal>
   PORT=5123

   # GitHub Integration
   GITHUB_TOKEN=<your GitHub Personal Access Token>
   GITHUB_WEBHOOK_SECRET=<random secret for webhook security>
   PUBLIC_URL=https://your-bot.onrender.com
   ```

3. **Run the bot locally**
   ```bash
   bun run dev
   ```

4. **Expose webhook with ngrok** (for testing)
   ```bash
   ngrok http 5123
   ```

5. **Update webhook URL in Developer Portal**
   - Set to: `https://your-ngrok-url.ngrok-free.app/webhook`

## Environment Variables

### Required
- `APP_PRIVATE_DATA` - Your Towns bot private key (from Developer Portal)
- `JWT_SECRET` - JWT secret for webhook authentication (from Developer Portal)

### Optional (but recommended for GitHub features)
- `GITHUB_TOKEN` - GitHub Personal Access Token (see below)
- `GITHUB_WEBHOOK_SECRET` - Secret for GitHub webhook signature verification
- `PUBLIC_URL` - Your bot's public URL (e.g., https://your-bot.onrender.com)
- `PORT` - Port to run on (default: 5123)

## Getting GitHub Personal Access Token (PAT)

The bot uses a GitHub PAT to query the GitHub API for public repositories.

### Steps to Create a GitHub PAT:

1. **Go to GitHub Settings**
   - Visit: https://github.com/settings/tokens
   - Click "Personal access tokens" → "Tokens (classic)"

2. **Generate New Token**
   - Click "Generate new token (classic)"
   - Name: `Towns Bot - Public Repos`
   - Expiration: Choose your preference (90 days recommended)

3. **Select Scopes**

   For **public repos only** (MVP), you need minimal scopes:
   - ✅ `public_repo` - Access public repositories

   **OR** if you want full access:
   - ✅ `repo` - Full control of private repositories (includes public)

4. **Generate and Copy**
   - Click "Generate token"
   - **Copy the token immediately** (you won't see it again!)
   - Paste into your `.env` file as `GITHUB_TOKEN`

### Rate Limits
- **Without token**: 60 requests/hour (not recommended)
- **With PAT**: 5,000 requests/hour (recommended for production)

### Security Notes
- **Never commit** your PAT to git
- `.env` is in `.gitignore` by default
- Use environment variables in production (Render, Railway, etc.)
- Regenerate token if accidentally exposed

## Usage

### Subscribe to GitHub Repository

1. In a Towns channel, run:
   ```
   /github subscribe facebook/react
   ```

2. Follow the instructions to configure the GitHub webhook:
   - Go to `https://github.com/facebook/react/settings/hooks/new`
   - Payload URL: `https://your-bot.onrender.com/github-webhook`
   - Content type: `application/json`
   - Secret: (value of `GITHUB_WEBHOOK_SECRET`)
   - Events: Select individual events or "Send me everything"
   - Click "Add webhook"

3. Start receiving notifications!

### Query GitHub Data

```
/gh-pr facebook/react 123      # Show PR details
/gh-issue facebook/react 456   # Show issue details
/github status                 # Show subscriptions
```

### Auto-Unfurl

Just paste a GitHub URL:
```
https://github.com/facebook/react/pull/28837
```
The bot will automatically expand it with details.

## Supported GitHub Events

- `pull_request` - Opened, closed, merged
- `issues` - Opened, closed
- `push` - Commits to branches
- `release` - Published
- `workflow_run` - CI/CD status
- `issue_comment` - New comments
- `pull_request_review` - PR reviews

## Code Structure

```
src/
├── index.ts       # Main bot logic
│   ├── Storage (in-memory maps)
│   ├── GitHub API helpers
│   ├── Event formatters
│   ├── Slash command handlers
│   ├── GitHub webhook endpoint
│   └── Hono app setup
└── commands.ts    # Slash command definitions
```

## Production Deployment

1. **Push to GitHub**
2. **Deploy to Render/Railway/Fly.io**
3. **Set environment variables** in hosting platform
4. **Update webhook URL** in Developer Portal
5. **Test with `/help` command**

## Limitations (MVP)

- **Public repos only** - No OAuth, uses bot's PAT
- **In-memory storage** - Subscriptions lost on restart (use SQLite for production)
- **No interactive actions** - Towns doesn't support buttons yet
- **No private repo access** - Would require per-user OAuth

## Future Enhancements

- [ ] SQLite/PostgreSQL persistence
- [ ] Per-user OAuth for private repos
- [ ] More slash commands (`/github search`, `/github releases`)
- [ ] Scheduled digests (daily summary)
- [ ] Thread organization for related events
- [ ] Reaction-based actions (when Towns supports)
