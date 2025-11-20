import type { Context } from "hono";

import type { GitHubApp } from "../github-app/app";
import type { WebhookProcessor } from "../github-app/webhook-processor";

export async function handleGitHubWebhook(
  c: Context,
  githubApp: GitHubApp,
  webhookProcessor: WebhookProcessor
) {
  if (!githubApp.isEnabled()) {
    return c.json({ error: "GitHub App not configured" }, 503);
  }

  const deliveryId = c.req.header("x-github-delivery");
  const signature = c.req.header("x-hub-signature-256");
  const event = c.req.header("x-github-event");

  if (!deliveryId || !signature || !event) {
    return c.json({ error: "Missing required headers" }, 400);
  }

  if (await webhookProcessor.isProcessed(deliveryId)) {
    console.log(`Webhook ${deliveryId} already processed, skipping`);
    return c.json({ message: "Already processed" }, 200);
  }

  try {
    const body = await c.req.text();

    await githubApp.webhooks.verifyAndReceive({
      id: deliveryId,
      name: event as any,
      signature: signature,
      payload: body,
    });

    let installationId: number | undefined;
    if (event.includes("installation")) {
      try {
        const parsed = JSON.parse(body) as { installation?: { id?: number } };
        installationId = parsed.installation?.id;
      } catch {
        // Ignore parse errors
      }
    }

    await webhookProcessor.markProcessed(
      deliveryId,
      installationId,
      event,
      "success"
    );

    return c.json({ ok: true });
  } catch (error) {
    console.error("Webhook processing error:", error);

    const errorMessage =
      error instanceof Error ? error.message : "Unknown error";

    if (errorMessage.includes("signature")) {
      return c.json({ error: "Invalid signature" }, 401);
    }
    return c.json({ error: "Processing failed" }, 500);
  }
}
