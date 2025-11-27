import type { Context } from "hono";

import { getOwnerIdFromUsername, parseRepo } from "../api/github-client";
import { DEFAULT_EVENT_TYPES_ARRAY } from "../constants";
import {
  generateInstallUrl,
  type InstallationService,
} from "../github-app/installation-service";
import type { GitHubOAuthService } from "../services/github-oauth-service";
import type { SubscriptionService } from "../services/subscription-service";
import type { TownsBot } from "../types/bot";
import { renderError, renderSuccess } from "../views/oauth-pages";

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
  bot: TownsBot,
  installationService: InstallationService
) {
  const code = c.req.query("code");
  const state = c.req.query("state");

  if (!code || !state) {
    return renderError(c, "Missing code or state parameter", 400);
  }

  try {
    // Handle OAuth callback
    const {
      githubLogin,
      channelId,
      spaceId,
      townsUserId,
      redirectAction,
      redirectData,
    } = await oauthService.handleCallback(code, state);

    const message = `✅ GitHub account @${githubLogin} connected successfully!`;
    // Check if we should edit an existing message or send a new one
    if (redirectData?.messageEventId) {
      // Edit the OAuth prompt message to show success
      try {
        await bot.editMessage(channelId, redirectData.messageEventId, message);
      } catch (error) {
        // If edit fails (message deleted, etc.), fall back to sending new message
        console.error("Failed to edit OAuth message:", error);
        await bot.sendMessage(channelId, message);
      }
    } else {
      // Send new success message (for fresh OAuth connections or old flow)
      await bot.sendMessage(channelId, message);
    }

    // If there was a redirect action (e.g., subscribe), complete the subscription
    if (redirectAction === "subscribe" && redirectData) {
      if (redirectData.repo && spaceId && townsUserId) {
        // Attempt subscription now that OAuth is complete
        const subResult = await subscriptionService.createSubscription({
          townsUserId,
          spaceId,
          channelId,
          repoIdentifier: redirectData.repo,
          eventTypes: redirectData.eventTypes ?? [...DEFAULT_EVENT_TYPES_ARRAY],
        });

        if (subResult.success) {
          // Success - notify in Towns
          const deliveryInfo =
            subResult.deliveryMode === "webhook"
              ? "⚡ Real-time webhook delivery enabled!"
              : `⏱️ Events checked every 5 minutes\n\n💡 [Install the GitHub App](<${subResult.installUrl}>) for real-time delivery`;

          const { eventId } = await bot.sendMessage(
            channelId,
            `✅ **Subscribed to [${subResult.repoFullName}](https://github.com/${subResult.repoFullName})**\n\n${deliveryInfo}`
          );

          // Track polling messages for potential upgrade to webhook
          if (subResult.deliveryMode === "polling" && eventId) {
            subscriptionService.registerPendingMessage(
              channelId,
              subResult.repoFullName,
              eventId
            );
          }

          // Return success page with subscription data
          return renderSuccess(c, {
            action: "subscribe",
            subscriptionResult: subResult,
          });
        } else if (!subResult.success && subResult.requiresInstallation) {
          // Private repo - show installation page (no Towns message)
          return renderSuccess(c, {
            action: "subscribe",
            subscriptionResult: subResult,
          });
        } else {
          // Other error - notify in Towns
          await bot.sendMessage(channelId, `❌ ${subResult.error}`);

          return renderSuccess(c, {
            action: "subscribe",
            subscriptionResult: subResult,
          });
        }
      }
    }

    // Handle query command redirect (gh_pr, gh_issue)
    // Check if app installation is needed for the repo
    if (redirectAction === "query" && redirectData?.repo) {
      const repo = redirectData.repo;
      const installationId = await installationService.isRepoInstalled(repo);

      if (!installationId) {
        // App not installed - show installation required page with auto-redirect
        const [owner] = parseRepo(repo);
        const ownerId = await getOwnerIdFromUsername(owner);
        const installUrl = generateInstallUrl(ownerId);

        return renderSuccess(c, {
          action: "query",
          requiresInstallation: true,
          repoFullName: repo,
          installUrl,
        });
      }
      // App installed - just show success page, user can run command again
    }

    return renderSuccess(c);
  } catch (error) {
    console.error("OAuth callback error:", error);

    // Return generic error to user, keep details in server logs
    return renderError(c, "Authorization failed. Please try again.", 400);
  }
}
