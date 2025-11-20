import { App } from "@octokit/app";
import type { Octokit } from "@octokit/core";
import { Webhooks } from "@octokit/webhooks";

/**
 * GitHubApp - Core GitHub App integration
 *
 * Handles GitHub App authentication and webhook processing using Octokit.
 * Octokit internally manages JWT generation and installation token caching.
 */
export class GitHubApp {
  private app: App;
  public webhooks: Webhooks;

  constructor() {
    // GitHub App configuration from environment
    const appId = process.env.GITHUB_APP_ID;
    const privateKeyBase64 = process.env.GITHUB_APP_PRIVATE_KEY_BASE64;
    const clientId = process.env.GITHUB_APP_CLIENT_ID;
    const clientSecret = process.env.GITHUB_APP_CLIENT_SECRET;
    const webhookSecret = process.env.GITHUB_WEBHOOK_SECRET;

    // Check if GitHub App is configured
    if (!appId || !privateKeyBase64 || !webhookSecret) {
      console.warn("GitHub App not configured - webhook mode disabled");
      console.warn(
        "Set GITHUB_APP_ID, GITHUB_APP_PRIVATE_KEY_BASE64, and GITHUB_WEBHOOK_SECRET to enable"
      );
      // Create dummy instances to avoid errors
      this.app = null as any;
      this.webhooks = null as any;
      return;
    }

    // Decode base64 private key
    const privateKey = Buffer.from(privateKeyBase64, "base64").toString();

    // Initialize Octokit App
    this.app = new App({
      appId,
      privateKey,
      oauth:
        clientId && clientSecret
          ? {
              clientId,
              clientSecret,
            }
          : undefined,
    });

    // Initialize Webhooks handler
    this.webhooks = new Webhooks({
      secret: webhookSecret,
    });

    console.log("GitHub App initialized successfully");
  }

  /**
   * Get app-authenticated Octokit instance
   *
   * Uses JWT authentication for app-level operations such as:
   * - Getting installation details
   * - Listing installations
   * - App management endpoints
   *
   * @returns JWT-authenticated Octokit instance
   */
  getAppOctokit(): Octokit {
    if (!this.app) {
      throw new Error("GitHub App not configured");
    }
    return this.app.octokit;
  }

  /**
   * Check if GitHub App is configured and enabled
   */
  isEnabled(): boolean {
    return this.app !== null && this.webhooks !== null;
  }

  /**
   * Get OAuth instance for user authentication
   * Returns undefined if OAuth is not configured
   */
  getOAuth() {
    if (!this.app) {
      return undefined;
    }
    return this.app.oauth;
  }
}
