/**
 * Type aliases for GitHub webhook event payloads
 * Provides cleaner, shorter type names while using the Octokit webhooks package under the hood
 */

import type {
  EmitterWebhookEvent,
  EmitterWebhookEventName,
} from "@octokit/webhooks";

type WebhookPayload<T extends EmitterWebhookEventName> =
  EmitterWebhookEvent<T>["payload"];

export type PullRequestPayload = WebhookPayload<"pull_request">;
export type IssuesPayload = WebhookPayload<"issues">;
export type PushPayload = WebhookPayload<"push">;
export type ReleasePayload = WebhookPayload<"release">;
export type WorkflowRunPayload = WebhookPayload<"workflow_run">;
export type IssueCommentPayload = WebhookPayload<"issue_comment">;
export type PullRequestReviewPayload = WebhookPayload<"pull_request_review">;
export type InstallationPayload = WebhookPayload<"installation">;
export type InstallationRepositoriesPayload =
  WebhookPayload<"installation_repositories">;
export type CreatePayload = WebhookPayload<"create">;
export type DeletePayload = WebhookPayload<"delete">;
export type ForkPayload = WebhookPayload<"fork">;
export type WatchPayload = WebhookPayload<"watch">;
