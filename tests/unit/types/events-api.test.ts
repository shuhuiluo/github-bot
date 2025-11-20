import { describe, expect, test } from "bun:test";

import { validateGitHubEvent } from "../../../src/types/events-api";

describe("validateGitHubEvent", () => {
  const baseEvent = {
    id: "12345",
    actor: { login: "testuser" },
    repo: { name: "owner/repo" },
  };

  describe("PullRequestEvent", () => {
    test("validates opened PR with full details", () => {
      const event = {
        ...baseEvent,
        type: "PullRequestEvent",
        payload: {
          action: "opened",
          number: 123,
          pull_request: {
            number: 123,
            title: "Test PR",
            html_url: "https://github.com/owner/repo/pull/123",
            user: { login: "author" },
            merged: false,
          },
        },
      };

      const result = validateGitHubEvent(event);
      expect(result).not.toBeNull();
      expect(result?.type).toBe("PullRequestEvent");
      expect(result?.payload.action).toBe("opened");
    });

    test("validates closed PR with minimal fields", () => {
      const event = {
        ...baseEvent,
        type: "PullRequestEvent",
        payload: {
          action: "closed",
          number: 123,
          pull_request: {
            number: 123,
          },
        },
      };

      const result = validateGitHubEvent(event);
      expect(result).not.toBeNull();
      expect(result?.type).toBe("PullRequestEvent");
    });

    test("validates PR without pull_request object", () => {
      const event = {
        ...baseEvent,
        type: "PullRequestEvent",
        payload: {
          action: "synchronize",
        },
      };

      const result = validateGitHubEvent(event);
      expect(result).not.toBeNull();
    });

    test("rejects invalid action", () => {
      const event = {
        ...baseEvent,
        type: "PullRequestEvent",
        payload: {
          action: "invalid_action",
        },
      };

      const result = validateGitHubEvent(event);
      expect(result).toBeNull();
    });
  });

  describe("IssuesEvent", () => {
    test("validates opened issue", () => {
      const event = {
        ...baseEvent,
        type: "IssuesEvent",
        payload: {
          action: "opened",
          issue: {
            number: 456,
            title: "Test Issue",
            html_url: "https://github.com/owner/repo/issues/456",
            user: { login: "author" },
          },
        },
      };

      const result = validateGitHubEvent(event);
      expect(result).not.toBeNull();
      expect(result?.type).toBe("IssuesEvent");
      expect(result?.payload.action).toBe("opened");
    });

    test("validates issue without issue object", () => {
      const event = {
        ...baseEvent,
        type: "IssuesEvent",
        payload: {
          action: "closed",
        },
      };

      const result = validateGitHubEvent(event);
      expect(result).not.toBeNull();
    });
  });

  describe("PushEvent", () => {
    test("validates push with commits", () => {
      const event = {
        ...baseEvent,
        type: "PushEvent",
        payload: {
          ref: "refs/heads/main",
          commits: [
            { sha: "abc123", message: "Initial commit" },
            { sha: "def456", message: "Second commit" },
          ],
        },
      };

      const result = validateGitHubEvent(event);
      expect(result).not.toBeNull();
      expect(result?.type).toBe("PushEvent");
    });

    test("validates push without commits", () => {
      const event = {
        ...baseEvent,
        type: "PushEvent",
        payload: {
          ref: "refs/heads/main",
        },
      };

      const result = validateGitHubEvent(event);
      expect(result).not.toBeNull();
    });
  });

  describe("ReleaseEvent", () => {
    test("validates published release", () => {
      const event = {
        ...baseEvent,
        type: "ReleaseEvent",
        payload: {
          action: "published",
          release: {
            tag_name: "v1.0.0",
            name: "Version 1.0.0",
            html_url: "https://github.com/owner/repo/releases/tag/v1.0.0",
            author: { login: "releaser" },
          },
        },
      };

      const result = validateGitHubEvent(event);
      expect(result).not.toBeNull();
      expect(result?.type).toBe("ReleaseEvent");
    });
  });

  describe("WorkflowRunEvent", () => {
    test("validates completed workflow", () => {
      const event = {
        ...baseEvent,
        type: "WorkflowRunEvent",
        payload: {
          action: "completed",
          workflow_run: {
            name: "CI",
            conclusion: "success",
            head_branch: "main",
            html_url: "https://github.com/owner/repo/actions/runs/123",
          },
        },
      };

      const result = validateGitHubEvent(event);
      expect(result).not.toBeNull();
      expect(result?.type).toBe("WorkflowRunEvent");
    });
  });

  describe("IssueCommentEvent", () => {
    test("validates created comment", () => {
      const event = {
        ...baseEvent,
        type: "IssueCommentEvent",
        payload: {
          action: "created",
          issue: { number: 123 },
          comment: {
            body: "Test comment",
            html_url: "https://github.com/owner/repo/issues/123#comment-456",
            user: { login: "commenter" },
          },
        },
      };

      const result = validateGitHubEvent(event);
      expect(result).not.toBeNull();
      expect(result?.type).toBe("IssueCommentEvent");
    });
  });

  describe("PullRequestReviewEvent", () => {
    test("validates created review with 'created' action", () => {
      const event = {
        ...baseEvent,
        type: "PullRequestReviewEvent",
        payload: {
          action: "created",
          pull_request: {
            number: 123,
            title: "Test PR",
          },
          review: {
            state: "approved",
            html_url: "https://github.com/owner/repo/pull/123#review-456",
            user: { login: "reviewer" },
          },
        },
      };

      const result = validateGitHubEvent(event);
      expect(result).not.toBeNull();
      expect(result?.type).toBe("PullRequestReviewEvent");
      expect(result?.payload.action).toBe("created");
    });

    test("validates updated review", () => {
      const event = {
        ...baseEvent,
        type: "PullRequestReviewEvent",
        payload: {
          action: "updated",
          pull_request: { number: 123 },
          review: { state: "changes_requested" },
        },
      };

      const result = validateGitHubEvent(event);
      expect(result).not.toBeNull();
    });

    test("validates dismissed review", () => {
      const event = {
        ...baseEvent,
        type: "PullRequestReviewEvent",
        payload: {
          action: "dismissed",
        },
      };

      const result = validateGitHubEvent(event);
      expect(result).not.toBeNull();
    });

    test("rejects old 'submitted' action", () => {
      const event = {
        ...baseEvent,
        type: "PullRequestReviewEvent",
        payload: {
          action: "submitted",
        },
      };

      const result = validateGitHubEvent(event);
      expect(result).toBeNull();
    });
  });

  describe("CreateEvent", () => {
    test("validates branch creation", () => {
      const event = {
        ...baseEvent,
        type: "CreateEvent",
        payload: {
          ref: "feature-branch",
          ref_type: "branch",
          master_branch: "main",
          description: null,
          pusher_type: "user",
        },
      };

      const result = validateGitHubEvent(event);
      expect(result).not.toBeNull();
      expect(result?.type).toBe("CreateEvent");
    });

    test("validates tag creation", () => {
      const event = {
        ...baseEvent,
        type: "CreateEvent",
        payload: {
          ref: "v1.0.0",
          ref_type: "tag",
        },
      };

      const result = validateGitHubEvent(event);
      expect(result).not.toBeNull();
    });
  });

  describe("DeleteEvent", () => {
    test("validates branch deletion", () => {
      const event = {
        ...baseEvent,
        type: "DeleteEvent",
        payload: {
          ref: "old-branch",
          ref_type: "branch",
          pusher_type: "user",
        },
      };

      const result = validateGitHubEvent(event);
      expect(result).not.toBeNull();
      expect(result?.type).toBe("DeleteEvent");
    });

    test("validates tag deletion", () => {
      const event = {
        ...baseEvent,
        type: "DeleteEvent",
        payload: {
          ref: "v0.1.0",
          ref_type: "tag",
        },
      };

      const result = validateGitHubEvent(event);
      expect(result).not.toBeNull();
    });
  });

  describe("PullRequestReviewCommentEvent", () => {
    test("validates created review comment", () => {
      const event = {
        ...baseEvent,
        type: "PullRequestReviewCommentEvent",
        payload: {
          action: "created",
          pull_request: { number: 123 },
          comment: {
            body: "Please fix this",
            path: "src/index.ts",
            position: 10,
            line: 42,
            html_url: "https://github.com/owner/repo/pull/123#comment-789",
            user: { login: "reviewer" },
          },
        },
      };

      const result = validateGitHubEvent(event);
      expect(result).not.toBeNull();
      expect(result?.type).toBe("PullRequestReviewCommentEvent");
    });

    test("validates comment with null position and line", () => {
      const event = {
        ...baseEvent,
        type: "PullRequestReviewCommentEvent",
        payload: {
          action: "edited",
          comment: {
            body: "Updated comment",
            position: null,
            line: null,
            html_url: "https://github.com/owner/repo/pull/123#comment-789",
          },
        },
      };

      const result = validateGitHubEvent(event);
      expect(result).not.toBeNull();
    });
  });

  describe("WatchEvent", () => {
    test("validates started action", () => {
      const event = {
        ...baseEvent,
        type: "WatchEvent",
        payload: {
          action: "started",
        },
      };

      const result = validateGitHubEvent(event);
      expect(result).not.toBeNull();
      expect(result?.type).toBe("WatchEvent");
    });

    test("rejects other actions", () => {
      const event = {
        ...baseEvent,
        type: "WatchEvent",
        payload: {
          action: "stopped",
        },
      };

      const result = validateGitHubEvent(event);
      expect(result).toBeNull();
    });
  });

  describe("ForkEvent", () => {
    test("validates fork event with forkee info", () => {
      const event = {
        ...baseEvent,
        type: "ForkEvent",
        payload: {
          forkee: {
            full_name: "testuser/repo-fork",
            html_url: "https://github.com/testuser/repo-fork",
          },
        },
      };

      const result = validateGitHubEvent(event);
      expect(result).not.toBeNull();
      expect(result?.type).toBe("ForkEvent");
    });

    test("allows missing forkee data", () => {
      const event = {
        ...baseEvent,
        type: "ForkEvent",
        payload: {},
      };

      const result = validateGitHubEvent(event);
      expect(result).not.toBeNull();
    });
  });

  describe("invalid events", () => {
    test("rejects event with missing type", () => {
      const event = {
        ...baseEvent,
        payload: {},
      };

      const result = validateGitHubEvent(event);
      expect(result).toBeNull();
    });

    test("rejects event with unknown type", () => {
      const event = {
        ...baseEvent,
        type: "UnknownEvent",
        payload: {},
      };

      const result = validateGitHubEvent(event);
      expect(result).toBeNull();
    });

    test("rejects event with missing base fields", () => {
      const event = {
        type: "PullRequestEvent",
        payload: { action: "opened" },
      };

      const result = validateGitHubEvent(event);
      expect(result).toBeNull();
    });
  });
});
