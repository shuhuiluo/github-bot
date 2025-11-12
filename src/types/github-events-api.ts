/**
 * Type definitions for GitHub Events API
 * Extends Octokit's official types with discriminated payload unions
 * https://docs.github.com/en/rest/activity/events
 */

import type { Endpoints } from "@octokit/types";

/**
 * Base event structure from Octokit's official types
 * We use this as the foundation and only refine the payload types
 */
type OctokitEvent =
  Endpoints["GET /repos/{owner}/{repo}/events"]["response"]["data"][number];

type BaseGitHubEvent = Omit<OctokitEvent, "payload">;

/**
 * Pull Request Event Payload
 */
export interface PullRequestPayload {
  action:
    | "assigned"
    | "unassigned"
    | "labeled"
    | "unlabeled"
    | "opened"
    | "edited"
    | "closed"
    | "reopened"
    | "synchronize"
    | "converted_to_draft"
    | "locked"
    | "unlocked"
    | "enqueued"
    | "dequeued"
    | "milestoned"
    | "demilestoned"
    | "ready_for_review"
    | "review_requested"
    | "review_request_removed"
    | "auto_merge_enabled"
    | "auto_merge_disabled";
  number?: number;
  pull_request?: {
    number: number;
    title: string;
    html_url: string;
    user: {
      login: string;
    };
    merged: boolean;
  };
}

export interface PullRequestEvent extends BaseGitHubEvent {
  type: "PullRequestEvent";
  payload: PullRequestPayload;
}

/**
 * Issues Event Payload
 */
export interface IssuesPayload {
  action:
    | "opened"
    | "edited"
    | "deleted"
    | "transferred"
    | "pinned"
    | "unpinned"
    | "closed"
    | "reopened"
    | "assigned"
    | "unassigned"
    | "labeled"
    | "unlabeled"
    | "locked"
    | "unlocked"
    | "milestoned"
    | "demilestoned";
  issue?: {
    number: number;
    title: string;
    html_url: string;
    user: {
      login: string;
    };
  };
}

export interface IssuesEvent extends BaseGitHubEvent {
  type: "IssuesEvent";
  payload: IssuesPayload;
}

/**
 * Push Event Payload
 */
export interface PushPayload {
  ref?: string;
  commits?: Array<{
    sha: string;
    message: string;
  }>;
}

export interface PushEvent extends BaseGitHubEvent {
  type: "PushEvent";
  payload: PushPayload;
}

/**
 * Release Event Payload
 */
export interface ReleasePayload {
  action:
    | "published"
    | "unpublished"
    | "created"
    | "edited"
    | "deleted"
    | "prereleased"
    | "released";
  release?: {
    tag_name: string;
    name: string | null;
    html_url: string;
    author: {
      login: string;
    };
  };
}

export interface ReleaseEvent extends BaseGitHubEvent {
  type: "ReleaseEvent";
  payload: ReleasePayload;
}

/**
 * Workflow Run Event Payload
 */
export interface WorkflowRunPayload {
  action: "requested" | "in_progress" | "completed";
  workflow_run?: {
    name: string;
    conclusion: string | null;
    head_branch: string;
    html_url: string;
  };
}

export interface WorkflowRunEvent extends BaseGitHubEvent {
  type: "WorkflowRunEvent";
  payload: WorkflowRunPayload;
}

/**
 * Issue Comment Event Payload
 */
export interface IssueCommentPayload {
  action: "created" | "edited" | "deleted";
  issue?: {
    number: number;
  };
  comment?: {
    body: string;
    html_url: string;
    user: {
      login: string;
    };
  };
}

export interface IssueCommentEvent extends BaseGitHubEvent {
  type: "IssueCommentEvent";
  payload: IssueCommentPayload;
}

/**
 * Pull Request Review Event Payload
 */
export interface PullRequestReviewPayload {
  action: "submitted" | "edited" | "dismissed";
  pull_request?: {
    number: number;
    title: string;
  };
  review?: {
    state: string;
    html_url: string;
    user: {
      login: string;
    };
  };
}

export interface PullRequestReviewEvent extends BaseGitHubEvent {
  type: "PullRequestReviewEvent";
  payload: PullRequestReviewPayload;
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
  | PullRequestReviewEvent;
