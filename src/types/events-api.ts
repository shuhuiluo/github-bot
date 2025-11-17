/**
 * Type definitions for GitHub Events API
 * Extends Octokit's official types with discriminated payload unions
 * Includes Zod schemas for runtime validation
 * https://docs.github.com/en/rest/activity/events
 */

import type { Endpoints } from "@octokit/types";
import { z } from "zod";

/**
 * Base event structure from Octokit's official types
 * We use this as the foundation and only refine the payload types
 */
type OctokitEvent =
  Endpoints["GET /repos/{owner}/{repo}/events"]["response"]["data"][number];

type BaseGitHubEvent = Omit<OctokitEvent, "payload">;

/**
 * Base event schema for runtime validation
 * Validates common fields present in all GitHub events
 */
const BaseEventSchema = z.object({
  id: z.string(),
  type: z.string(),
  actor: z.object({
    login: z.string(),
  }),
  repo: z.object({
    name: z.string(),
  }),
});

/**
 * Pull Request Event Payload
 */
export const PullRequestPayloadSchema = z.object({
  action: z.enum([
    "assigned",
    "unassigned",
    "labeled",
    "unlabeled",
    "opened",
    "edited",
    "closed",
    "reopened",
    "synchronize",
    "converted_to_draft",
    "locked",
    "unlocked",
    "enqueued",
    "dequeued",
    "milestoned",
    "demilestoned",
    "ready_for_review",
    "review_requested",
    "review_request_removed",
    "auto_merge_enabled",
    "auto_merge_disabled",
  ]),
  number: z.number().optional(),
  pull_request: z
    .object({
      number: z.number(),
      title: z.string().optional(),
      html_url: z.string().optional(),
      user: z
        .object({
          login: z.string(),
        })
        .optional(),
      merged: z.boolean().optional(),
    })
    .optional(),
});

export type PullRequestPayload = z.infer<typeof PullRequestPayloadSchema>;

export interface PullRequestEvent extends BaseGitHubEvent {
  type: "PullRequestEvent";
  payload: PullRequestPayload;
}

/**
 * Issues Event Payload
 */
export const IssuesPayloadSchema = z.object({
  action: z.enum([
    "opened",
    "edited",
    "deleted",
    "transferred",
    "pinned",
    "unpinned",
    "closed",
    "reopened",
    "assigned",
    "unassigned",
    "labeled",
    "unlabeled",
    "locked",
    "unlocked",
    "milestoned",
    "demilestoned",
  ]),
  issue: z
    .object({
      number: z.number(),
      title: z.string(),
      html_url: z.string(),
      user: z.object({
        login: z.string(),
      }),
    })
    .optional(),
});

export type IssuesPayload = z.infer<typeof IssuesPayloadSchema>;

export interface IssuesEvent extends BaseGitHubEvent {
  type: "IssuesEvent";
  payload: IssuesPayload;
}

/**
 * Push Event Payload
 */
export const PushPayloadSchema = z.object({
  ref: z.string().optional(),
  commits: z
    .array(
      z.object({
        sha: z.string(),
        message: z.string(),
      })
    )
    .optional(),
});

export type PushPayload = z.infer<typeof PushPayloadSchema>;

export interface PushEvent extends BaseGitHubEvent {
  type: "PushEvent";
  payload: PushPayload;
}

/**
 * Release Event Payload
 */
export const ReleasePayloadSchema = z.object({
  action: z.enum([
    "published",
    "unpublished",
    "created",
    "edited",
    "deleted",
    "prereleased",
    "released",
  ]),
  release: z
    .object({
      tag_name: z.string(),
      name: z.string().nullable(),
      html_url: z.string(),
      author: z.object({
        login: z.string(),
      }),
    })
    .optional(),
});

export type ReleasePayload = z.infer<typeof ReleasePayloadSchema>;

export interface ReleaseEvent extends BaseGitHubEvent {
  type: "ReleaseEvent";
  payload: ReleasePayload;
}

/**
 * Workflow Run Event Payload
 */
export const WorkflowRunPayloadSchema = z.object({
  action: z.enum(["requested", "in_progress", "completed"]),
  workflow_run: z
    .object({
      name: z.string(),
      conclusion: z.string().nullable(),
      head_branch: z.string(),
      html_url: z.string(),
    })
    .optional(),
});

export type WorkflowRunPayload = z.infer<typeof WorkflowRunPayloadSchema>;

export interface WorkflowRunEvent extends BaseGitHubEvent {
  type: "WorkflowRunEvent";
  payload: WorkflowRunPayload;
}

/**
 * Issue Comment Event Payload
 */
export const IssueCommentPayloadSchema = z.object({
  action: z.enum(["created", "edited", "deleted"]),
  issue: z
    .object({
      number: z.number(),
    })
    .optional(),
  comment: z
    .object({
      body: z.string(),
      html_url: z.string(),
      user: z.object({
        login: z.string(),
      }),
    })
    .optional(),
});

export type IssueCommentPayload = z.infer<typeof IssueCommentPayloadSchema>;

export interface IssueCommentEvent extends BaseGitHubEvent {
  type: "IssueCommentEvent";
  payload: IssueCommentPayload;
}

/**
 * Pull Request Review Event Payload
 */
export const PullRequestReviewPayloadSchema = z.object({
  action: z.enum(["created", "updated", "dismissed"]),
  pull_request: z
    .object({
      number: z.number(),
      title: z.string().optional(),
    })
    .optional(),
  review: z
    .object({
      state: z.string(),
      html_url: z.string().optional(),
      user: z
        .object({
          login: z.string(),
        })
        .optional(),
    })
    .optional(),
});

export type PullRequestReviewPayload = z.infer<
  typeof PullRequestReviewPayloadSchema
>;

export interface PullRequestReviewEvent extends BaseGitHubEvent {
  type: "PullRequestReviewEvent";
  payload: PullRequestReviewPayload;
}

/**
 * Create Event Payload (branch/tag creation)
 */
export const CreatePayloadSchema = z.object({
  ref: z.string().optional(),
  ref_type: z.enum(["branch", "tag"]).optional(),
  master_branch: z.string().optional(),
  description: z.string().nullable().optional(),
  pusher_type: z.string().optional(),
});

export type CreatePayload = z.infer<typeof CreatePayloadSchema>;

export interface CreateEvent extends BaseGitHubEvent {
  type: "CreateEvent";
  payload: CreatePayload;
}

/**
 * Delete Event Payload (branch/tag deletion)
 */
export const DeletePayloadSchema = z.object({
  ref: z.string().optional(),
  ref_type: z.enum(["branch", "tag"]).optional(),
  pusher_type: z.string().optional(),
});

export type DeletePayload = z.infer<typeof DeletePayloadSchema>;

export interface DeleteEvent extends BaseGitHubEvent {
  type: "DeleteEvent";
  payload: DeletePayload;
}

/**
 * Pull Request Review Comment Event Payload (code review comments)
 */
export const PullRequestReviewCommentPayloadSchema = z.object({
  action: z.enum(["created", "edited", "deleted"]),
  pull_request: z
    .object({
      number: z.number(),
    })
    .optional(),
  comment: z
    .object({
      body: z.string(),
      path: z.string().optional(),
      position: z.number().nullable().optional(),
      line: z.number().nullable().optional(),
      html_url: z.string(),
      user: z
        .object({
          login: z.string(),
        })
        .optional(),
    })
    .optional(),
});

export type PullRequestReviewCommentPayload = z.infer<
  typeof PullRequestReviewCommentPayloadSchema
>;

export interface PullRequestReviewCommentEvent extends BaseGitHubEvent {
  type: "PullRequestReviewCommentEvent";
  payload: PullRequestReviewCommentPayload;
}

/**
 * Discriminated union of all supported GitHub Events
 */
export type GitHubEvent =
  | PullRequestEvent
  | IssuesEvent
  | PushEvent
  | ReleaseEvent
  | WorkflowRunEvent
  | IssueCommentEvent
  | PullRequestReviewEvent
  | CreateEvent
  | DeleteEvent
  | PullRequestReviewCommentEvent;

/**
 * Zod schema for validating GitHub Events
 * Discriminated union based on the event type
 */
export const GitHubEventSchema = z.discriminatedUnion("type", [
  BaseEventSchema.extend({
    type: z.literal("PullRequestEvent"),
    payload: PullRequestPayloadSchema,
  }),
  BaseEventSchema.extend({
    type: z.literal("IssuesEvent"),
    payload: IssuesPayloadSchema,
  }),
  BaseEventSchema.extend({
    type: z.literal("PushEvent"),
    payload: PushPayloadSchema,
  }),
  BaseEventSchema.extend({
    type: z.literal("ReleaseEvent"),
    payload: ReleasePayloadSchema,
  }),
  BaseEventSchema.extend({
    type: z.literal("WorkflowRunEvent"),
    payload: WorkflowRunPayloadSchema,
  }),
  BaseEventSchema.extend({
    type: z.literal("IssueCommentEvent"),
    payload: IssueCommentPayloadSchema,
  }),
  BaseEventSchema.extend({
    type: z.literal("PullRequestReviewEvent"),
    payload: PullRequestReviewPayloadSchema,
  }),
  BaseEventSchema.extend({
    type: z.literal("CreateEvent"),
    payload: CreatePayloadSchema,
  }),
  BaseEventSchema.extend({
    type: z.literal("DeleteEvent"),
    payload: DeletePayloadSchema,
  }),
  BaseEventSchema.extend({
    type: z.literal("PullRequestReviewCommentEvent"),
    payload: PullRequestReviewCommentPayloadSchema,
  }),
]);

/**
 * Validate a GitHub event against the schema
 * @param event - Raw event from GitHub API
 * @returns Validated event or null if validation fails
 */
export function validateGitHubEvent(event: unknown): GitHubEvent | null {
  const result = GitHubEventSchema.safeParse(event);

  if (!result.success) {
    const eventType = (event as Record<string, unknown>)?.type;
    const eventId = (event as Record<string, unknown>)?.id;

    console.error(
      // eslint-disable-next-line @typescript-eslint/no-base-to-string
      `GitHub event validation failed for ${String(eventType ?? "unknown")} (ID: ${String(eventId ?? "unknown")}):`,
      result.error.format()
    );
    return null;
  }

  return result.data as GitHubEvent;
}
