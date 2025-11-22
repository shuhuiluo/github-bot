import type { Context } from "hono";

import type { SubscribeResult } from "../services/subscription-service";
import { escapeHtml } from "../utils/html-escape";

/**
 * Render success page after OAuth completion - Main dispatcher
 */
export function renderSuccess(
  c: Context,
  data?: {
    action?: string;
    subscriptionResult?: SubscribeResult;
  }
) {
  if (!data?.subscriptionResult) {
    return renderOAuthOnlySuccess(c);
  }

  const sub = data.subscriptionResult;

  if (!sub.success && sub.requiresInstallation) {
    return renderInstallRequired(c, sub);
  }

  if (sub.success && sub.deliveryMode === "webhook") {
    return renderWebhookSuccess(c, sub);
  }

  if (sub.success && sub.deliveryMode === "polling") {
    return renderPollingSuccess(c, sub);
  }

  return renderSubscriptionError(c, sub);
}

/**
 * OAuth-only flow success page (no subscription)
 */
function renderOAuthOnlySuccess(c: Context) {
  return c.html(`
    <!DOCTYPE html>
    <html>
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>GitHub Connected</title>
        ${renderStyles()}
      </head>
      <body>
        <div class="container">
          <h1>✅ Success!</h1>
          <p>Your GitHub account has been connected.</p>
          <p>You can close this window and return to Towns.</p>
        </div>
      </body>
    </html>
  `);
}

/**
 * Private repo requiring GitHub App installation
 */
function renderInstallRequired(
  c: Context,
  sub: Extract<SubscribeResult, { requiresInstallation: true }>
) {
  const safeRepo = escapeHtml(sub.repoFullName);
  const safeInstallUrl = escapeHtml(sub.installUrl);

  return c.html(`
    <!DOCTYPE html>
    <html>
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Installation Required</title>
        ${renderStyles()}
      </head>
      <body>
        <div class="container">
          <h1>⚠️ GitHub App Installation Required</h1>
          <p class="repo-name">Repository: <strong>${safeRepo}</strong></p>
          <p>This private repository requires the GitHub App to be installed.</p>
          <p>Click the button below to install the app and enable subscription.</p>
          <a href="${safeInstallUrl}" class="install-button">Install GitHub App</a>
          <p class="note">After installation, return to Towns and run <code>/github subscribe ${safeRepo}</code> again.</p>
          <p class="redirect-info">Redirecting in <span id="countdown">2</span> seconds...</p>
        </div>
        <script>
          let countdown = 2;
          const countdownEl = document.getElementById('countdown');
          const interval = setInterval(() => {
            countdown--;
            if (countdownEl) countdownEl.textContent = String(countdown);
            if (countdown === 0) {
              clearInterval(interval);
              window.location.href = ${JSON.stringify(sub.installUrl)};
            }
          }, 1000);
        </script>
      </body>
    </html>
  `);
}

/**
 * Subscription success with webhook delivery
 */
function renderWebhookSuccess(
  c: Context,
  sub: Extract<SubscribeResult, { deliveryMode: "webhook" }>
) {
  const safeRepo = escapeHtml(sub.repoFullName);
  const safeEvents = escapeHtml(sub.eventTypes);

  return c.html(`
    <!DOCTYPE html>
    <html>
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Subscription Successful</title>
        ${renderStyles()}
      </head>
      <body>
        <div class="container">
          <h1>✅ Subscribed to ${safeRepo}!</h1>
          <p class="delivery-mode">⚡ Real-time webhook delivery enabled</p>
          <p><strong>Events:</strong> ${safeEvents.replace(/,/g, ", ")}</p>
          <p class="success-note">You can close this window and return to Towns.</p>
        </div>
      </body>
    </html>
  `);
}

/**
 * Subscription success with polling delivery (public repo without app)
 */
function renderPollingSuccess(
  c: Context,
  sub: Extract<SubscribeResult, { deliveryMode: "polling" }>
) {
  const safeRepo = escapeHtml(sub.repoFullName);
  const safeEvents = escapeHtml(sub.eventTypes);
  const safeInstallUrl = escapeHtml(sub.installUrl);
  const installMessage = "Install the GitHub App for real-time delivery:";

  return c.html(`
    <!DOCTYPE html>
    <html>
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Subscription Successful</title>
        ${renderStyles()}
      </head>
      <body>
        <div class="container">
          <h1>✅ Subscribed to ${safeRepo}!</h1>
          <p class="delivery-mode">⏱️ Currently using 5-minute polling</p>
          <p><strong>Events:</strong> ${safeEvents.replace(/,/g, ", ")}</p>
          <div class="install-section">
            <p>💡 <strong>Want real-time updates?</strong></p>
            <p>${installMessage}</p>
            <a href="${safeInstallUrl}" class="install-button">Install GitHub App</a>
            <p class="redirect-info">Auto-redirecting to installation in <span id="countdown">5</span> seconds...</p>
            <p class="note">You can close this window and return to Towns.</p>
          </div>
        </div>
        <script>
          let countdown = 5;
          const countdownEl = document.getElementById('countdown');
          const interval = setInterval(() => {
            countdown--;
            if (countdownEl) countdownEl.textContent = String(countdown);
            if (countdown === 0) {
              clearInterval(interval);
              window.location.href = ${JSON.stringify(sub.installUrl)};
            }
          }, 1000);
        </script>
      </body>
    </html>
  `);
}

/**
 * Subscription error page
 */
function renderSubscriptionError(
  c: Context,
  sub: Extract<SubscribeResult, { success: false }>
) {
  const safeError = escapeHtml(sub.error);

  return c.html(`
    <!DOCTYPE html>
    <html>
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Subscription Error</title>
        ${renderStyles()}
      </head>
      <body>
        <div class="container">
          <h1>❌ Subscription Failed</h1>
          <p>${safeError}</p>
          <p>Please return to Towns and try again.</p>
        </div>
      </body>
    </html>
  `);
}

/**
 * Render CSS styles for success pages
 */
function renderStyles() {
  return `
    <style>
      * {
        margin: 0;
        padding: 0;
        box-sizing: border-box;
      }
      body {
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Roboto', 'Oxygen', 'Ubuntu', 'Cantarell', sans-serif;
        background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
        min-height: 100vh;
        display: flex;
        align-items: center;
        justify-content: center;
        padding: 20px;
      }
      .container {
        background: white;
        border-radius: 12px;
        padding: 40px;
        max-width: 600px;
        width: 100%;
        box-shadow: 0 20px 60px rgba(0, 0, 0, 0.3);
      }
      h1 {
        color: #1a202c;
        margin-bottom: 20px;
        font-size: 28px;
        line-height: 1.3;
      }
      p {
        color: #4a5568;
        margin-bottom: 16px;
        font-size: 16px;
        line-height: 1.6;
      }
      .repo-name {
        font-size: 18px;
        color: #2d3748;
      }
      .delivery-mode {
        font-size: 18px;
        font-weight: 600;
        color: #2d3748;
        margin-bottom: 20px;
      }
      .install-section {
        margin-top: 30px;
        padding-top: 30px;
        border-top: 2px solid #e2e8f0;
      }
      .install-button {
        display: inline-block;
        background: #2d3748;
        color: white;
        padding: 14px 28px;
        border-radius: 8px;
        text-decoration: none;
        font-weight: 600;
        margin: 16px 0;
        transition: background 0.2s;
      }
      .install-button:hover {
        background: #1a202c;
      }
      .redirect-info {
        color: #718096;
        font-size: 14px;
        margin-top: 16px;
      }
      #countdown {
        font-weight: 700;
        color: #667eea;
      }
      .note {
        color: #718096;
        font-size: 14px;
        margin-top: 12px;
      }
      .success-note {
        color: #48bb78;
        font-weight: 500;
        margin-top: 24px;
      }
      code {
        background: #edf2f7;
        padding: 2px 6px;
        border-radius: 4px;
        font-family: 'Monaco', 'Courier New', monospace;
        font-size: 14px;
      }
      strong {
        color: #2d3748;
      }
    </style>
  `;
}

/**
 * Render error page with HTML-escaped message
 */
export function renderError(c: Context, message: string, status: 400 | 500) {
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
