import type { Context } from "hono";

import { DEFAULT_EVENT_TYPES } from "../constants/event-types";
import type { GitHubOAuthService } from "../services/github-oauth-service";
import type { SubscriptionService } from "../services/subscription-service";
import type { TownsBot } from "../types/bot";
import { escapeHtml } from "../utils/html-escape";

/**
 * OAuth callback route handler
 *
 * Handles the GitHub OAuth callback after user authorizes the app.
 * Exchanges the authorization code for an access token and stores it.
 * If the user was redirected from a subscription attempt, completes the subscription.
 */
export async function handleOAuthCallback(
  c: Context,
  oauthService: GitHubOAuthService,
  subscriptionService: SubscriptionService,
  bot: TownsBot
) {
  const code = c.req.query("code");
  const state = c.req.query("state");

  if (!code || !state) {
    return renderError(c, "Missing code or state parameter", 400);
  }

  try {
    // Handle OAuth callback
    const result = await oauthService.handleCallback(code, state);

    // Send success message to the channel
    await bot.sendMessage(
      result.channelId,
      `✅ GitHub account @${result.githubLogin} connected successfully!`
    );

    // If there was a redirect action (e.g., subscribe), complete the subscription
    if (result.redirectAction === "subscribe" && result.redirectData) {
      const data = result.redirectData as {
        repo?: string;
        eventTypes?: string;
      };
      if (data.repo && result.spaceId && result.townsUserId) {
        // Attempt subscription now that OAuth is complete
        const subResult = await subscriptionService.subscribeToRepository({
          townsUserId: result.townsUserId,
          spaceId: result.spaceId,
          channelId: result.channelId,
          repoIdentifier: data.repo,
          eventTypes: data.eventTypes || DEFAULT_EVENT_TYPES,
        });

        if (subResult.success && subResult.repoFullName) {
          // Success
          let deliveryInfo =
            subResult.deliveryMode === "webhook"
              ? "⚡ Real-time webhook delivery enabled!"
              : "⏱️ Events checked every 5 minutes";

          if (subResult.suggestInstall && subResult.installUrl) {
            const adminHint = subResult.isAdmin
              ? "Install the GitHub App for real-time delivery:"
              : "Ask an admin to install the GitHub App:";
            deliveryInfo += `\n\n💡 ${adminHint}\n[Install](<${subResult.installUrl}>)`;
          }

          await bot.sendMessage(
            result.channelId,
            `✅ **Subscribed to ${subResult.repoFullName}**\n\n${deliveryInfo}`
          );
        } else if (subResult.requiresInstallation && subResult.installUrl) {
          // Private repo - needs installation
          await bot.sendMessage(
            result.channelId,
            `🔒 **Installation Required**\n\n` +
              `This private repository requires the GitHub App.\n\n` +
              `[Install GitHub App](<${subResult.installUrl}>)`
          );
        } else {
          // Other error
          await bot.sendMessage(
            result.channelId,
            `❌ ${subResult.error || "Failed to subscribe to repository"}`
          );
        }
      }
    }

    return renderSuccess(c);
  } catch (error) {
    console.error("OAuth callback error:", error);

    // Return generic error to user, keep details in server logs
    return renderError(c, "Authorization failed. Please try again.", 400);
  }
}

/**
 * Render success page after OAuth completion
 */
function renderSuccess(c: Context) {
  return c.html(`
    <!DOCTYPE html>
    <html>
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>GitHub Connected</title>
      </head>
      <body>
        <h1>Success!</h1>
        <p>Your GitHub account has been connected.</p>
        <p>You can close this window and return to Towns.</p>
      </body>
    </html>
  `);
}

/**
 * Render error page with HTML-escaped message
 */
function renderError(c: Context, message: string, status: 400 | 500) {
  const safeMessage = escapeHtml(message);

  return c.html(
    `
    <!DOCTYPE html>
    <html>
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>OAuth Error</title>
      </head>
      <body>
        <h1>OAuth Error</h1>
        <p>${safeMessage}</p>
      </body>
    </html>
    `,
    status
  );
}
