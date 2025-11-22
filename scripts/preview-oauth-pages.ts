/**
 * Preview script for OAuth success pages
 * Generates static HTML files for each page variant
 */
import { mkdirSync, writeFileSync } from "node:fs";

import type { SubscribeResult } from "../src/services/subscription-service";
import { renderError, renderSuccess } from "../src/views/oauth-pages";

// Create a mock Hono context for preview
function createMockContext() {
  return {
    html: (content: string, status?: number) => {
      return {
        text: async () => content,
        status,
      };
    },
  };
}

// Mock subscription results for each variant
const mockResults: Record<string, SubscribeResult> = {
  "webhook-success": {
    success: true,
    deliveryMode: "webhook",
    repoFullName: "HereNotThere/bot-github",
    eventTypes: "pr,issues,commits,releases",
  },
  "polling-success": {
    success: true,
    deliveryMode: "polling",
    repoFullName: "HereNotThere/bot-github",
    eventTypes: "pr,issues,commits",
    installUrl:
      "https://github.com/apps/towns-github-bot-test/installations/new/permissions?target_id=98539902",
  },
  "install-required": {
    success: false,
    requiresInstallation: true,
    installUrl:
      "https://github.com/apps/towns-github-bot-test/installations/new/permissions?target_id=98539902",
    repoFullName: "HereNotThere/bot-github",
    eventTypes: "pr,issues,commits",
    error: "Private repository requires GitHub App installation",
  },
  "subscription-error": {
    success: false,
    requiresInstallation: false,
    error: "Already subscribed to HereNotThere/bot-github",
  },
};

// Generate HTML for each variant
async function generatePreviews() {
  const outputDir = "./preview-pages";

  try {
    mkdirSync(outputDir, { recursive: true });
  } catch (e) {
    // Directory exists, that's fine
  }

  // OAuth-only success (no subscription)
  const oauthOnly = await renderSuccess(createMockContext() as any, undefined);
  const oauthOnlyHtml = await oauthOnly.text();
  writeFileSync(`${outputDir}/oauth-only.html`, oauthOnlyHtml);
  console.log("✓ Generated oauth-only.html");

  // Each subscription result variant
  for (const [name, result] of Object.entries(mockResults)) {
    const response = await renderSuccess(createMockContext() as any, {
      action: "subscribe",
      subscriptionResult: result,
    });
    const html = await response.text();
    writeFileSync(`${outputDir}/${name}.html`, html);
    console.log(`✓ Generated ${name}.html`);
  }

  // Error page
  const errorResponse = await renderError(
    createMockContext() as any,
    "Authorization failed. Please try again.",
    400
  );
  const errorHtml = await errorResponse.text();
  writeFileSync(`${outputDir}/oauth-error.html`, errorHtml);
  console.log("✓ Generated oauth-error.html");

  console.log(`\n📁 Preview files generated in ${outputDir}/`);
  console.log("\nOpen these files in your browser:");
  console.log(
    `  - oauth-only.html          (OAuth connected, no subscription)`
  );
  console.log(
    `  - webhook-success.html     (Subscription with real-time webhooks)`
  );
  console.log(
    `  - polling-success.html     (Subscription with 5-min polling + install prompt)`
  );
  console.log(
    `  - install-required.html    (Private repo requiring app installation)`
  );
  console.log(`  - subscription-error.html  (Subscription failed error)`);
  console.log(`  - oauth-error.html         (OAuth authorization error)`);
}

generatePreviews().catch(console.error);
