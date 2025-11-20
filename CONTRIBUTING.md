# Contributing to GitHub Bot for Towns

Thank you for your interest in contributing! This guide covers development setup, configuration, and best practices.

## Development Setup

### Prerequisites

- **Bun** installed (`curl -fsSL https://bun.sh/install | bash`)
- **PostgreSQL** database (Docker recommended for local development)
- **Towns Bot** created via [Developer Portal](https://app.towns.com/developer)
- **GitHub App** (optional - see GitHub App Setup section)

### Getting Started

1. **Clone and install**

   ```bash
   git clone <repository-url>
   cd github-bot
   bun install
   ```

2. **Setup database**

   ```bash
   # Start PostgreSQL with Docker
   docker run --rm --name github-bot-db \
     -e POSTGRES_USER=postgres \
     -e POSTGRES_PASSWORD=postgres \
     -e POSTGRES_DB=github-bot \
     -p 5432:5432 \
     postgres:18
   ```

3. **Configure environment** (see Configuration section below)

4. **Run development server**

   ```bash
   bun run dev
   ```

5. **Expose webhook for testing**

   ```bash
   ngrok http 5123
   ```

6. **Update webhook URL** in Towns Developer Portal:
   - Set to: `https://your-ngrok-url.ngrok-free.app/webhook`

## Configuration

### Environment Variables Reference

#### Required

| Variable           | Description                    | Source                                                   |
| ------------------ | ------------------------------ | -------------------------------------------------------- |
| `APP_PRIVATE_DATA` | Base64-encoded bot credentials | Towns Developer Portal                                   |
| `JWT_SECRET`       | Webhook authentication token   | Towns Developer Portal                                   |
| `DATABASE_URL`     | PostgreSQL connection string   | Format: `postgresql://user:pass@host:port/db`            |
| `PUBLIC_URL`       | Publicly accessible bot URL    | Your hosting provider (e.g., `https://bot.onrender.com`) |

#### GitHub App (Optional - Enables Real-Time Webhooks)

| Variable                        | Description                                | How to Get                                                 |
|---------------------------------| ------------------------------------------ | ---------------------------------------------------------- |
| `GITHUB_APP_ID`                 | GitHub App ID                              | GitHub App settings page                                   |
| `GITHUB_APP_PRIVATE_KEY_BASE64` | Base64-encoded private key                 | Download `.pem`, encode: `base64 -i key.pem | tr -d '\n'`  |
| `GITHUB_APP_CLIENT_ID`          | OAuth client ID (format: `Iv1.abc123`)     | GitHub App OAuth settings                                  |
| `GITHUB_APP_CLIENT_SECRET`      | OAuth client secret                        | GitHub App OAuth settings                                  |
| `GITHUB_WEBHOOK_SECRET`         | Webhook signature secret                   | Generate: `openssl rand -hex 32`                           |
| `GITHUB_APP_SLUG`               | App URL slug (default: `towns-github-bot`) | Optional - for custom app names                            |

#### Optional Configuration

| Variable                     | Default     | Description                                                         |
| ---------------------------- | ----------- | ------------------------------------------------------------------- |
| `GITHUB_TOKEN`               | -           | GitHub Personal Access Token (for API calls, legacy polling)        |
| `PORT`                       | `3000`      | Server port                                                         |
| `DATABASE_SSL`               | `false`     | Enable SSL for database (set `true` for production)                 |
| `DATABASE_POOL_SIZE`         | `10`        | Connection pool size                                                |
| `DATABASE_CA_CERT_PATH`      | -           | Path to custom CA certificate                                       |
| `DEV_DISABLE_SSL_VALIDATION` | `false`     | Disable SSL validation (**dev only, never production**)             |
| `OAUTH_REDIRECT_URL`         | -           | Custom OAuth redirect URL (defaults to `PUBLIC_URL/oauth/callback`) |
| `DRIZZLE_MIGRATIONS_PATH`    | `./drizzle` | Custom database migrations path                                     |

> **See `.env.sample` for a complete example** with all available variables.

## Database Management

### Migrations

Migrations run automatically on startup. For manual control:

```bash
# Generate new migration from schema changes
bun run db:generate

# Run pending migrations
bun run db:migrate

# Push schema directly (development only)
bun run db:push
```

### Database Schema

The bot uses Drizzle ORM with PostgreSQL. Schema defined in:

- `src/db/schema.ts` - Table definitions
- `drizzle/` - Generated migration files

## GitHub App Setup

### Creating a GitHub App

1. **Visit** https://github.com/settings/apps/new

2. **Basic Information:**
   - **Name:** `Towns GitHub Bot`
   - **Homepage URL:** `https://github.com/your-org/towns-github-bot`
   - **Webhook URL:** `https://your-bot.onrender.com/github-webhook`
   - **Webhook Secret:** Generate random secret (`openssl rand -hex 32`)

3. **Repository Permissions:**
   - Contents: Read-only
   - Issues: Read-only
   - Pull requests: Read-only
   - Metadata: Read-only

4. **Organization Permissions:**
   - Members: Read-only

5. **Subscribe to Events:**
   - `pull_request`
   - `push`
   - `issues`
   - `release`
   - `workflow_run`
   - `issue_comment`
   - `pull_request_review`
   - `create`
   - `delete`
   - `fork`
   - `watch`

6. **OAuth Settings:**
   - **Callback URL:** `https://your-bot.onrender.com/oauth/callback`
   - **Request user authorization (OAuth) during installation:** Yes
   - **Enable Device Flow:** No

7. **After Creation:**
   - Note **App ID**
   - Note **Client ID**
   - Generate **Client Secret**
   - Generate **Private Key** (download `.pem` file)

8. **Add to .env:**

   ```bash
   # Base64 encode the private key
   base64 -i your-key.pem | tr -d '\n'

   # Add to .env
   GITHUB_APP_ID=<app-id>
   GITHUB_APP_PRIVATE_KEY_BASE64=<base64-encoded-key>
   GITHUB_APP_CLIENT_ID=<client-id>
   GITHUB_APP_CLIENT_SECRET=<client-secret>
   GITHUB_WEBHOOK_SECRET=<webhook-secret>
   ```

### Testing GitHub App Locally

1. **Start ngrok:**

   ```bash
   ngrok http 5123
   ```

2. **Update GitHub App webhook URL:**
   - Set to: `https://your-ngrok-url.ngrok-free.app/github-webhook`

3. **Install app on test repository:**
   - Visit: `https://github.com/apps/your-app-name/installations/new`
   - Select repository
   - Install

4. **Test in Towns:**
   ```
   /github subscribe owner/repo
   ```

## Development Workflow

### Code Quality

```bash
# Run linter
bun run lint

# Run type checker
bun run typecheck
```

### Project Structure

```
src/
├── handlers/           # Command and event handlers
├── services/          # Business logic (subscriptions, OAuth, etc.)
├── github-app/        # GitHub App webhook handlers
├── formatters/        # Message formatting for GitHub events
├── db/               # Database schema and queries
├── routes/           # HTTP route handlers
├── utils/            # Utility functions
└── index.ts          # Application entry point
```

## Deployment

### Environment Setup

1. **Database:** Create PostgreSQL database (Render, Neon, Railway)
2. **Hosting:** Deploy to Render, Railway, or Fly.io
3. **Environment Variables:** Set all required variables in hosting platform
4. **Webhook URLs:** Update in Towns Portal and GitHub App settings

### Production Checklist

- [ ] `DATABASE_SSL=true` enabled
- [ ] `DEV_DISABLE_SSL_VALIDATION` not set or `false`
- [ ] All secrets properly configured
- [ ] Webhook URLs pointing to production domain
- [ ] GitHub App installed on target repositories
- [ ] Database migrations run successfully
