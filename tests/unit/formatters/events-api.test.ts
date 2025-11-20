import { describe, expect, test } from "bun:test";

import type { GitHubPullRequest } from "../../../src/api/github-client";
import { formatEvent } from "../../../src/formatters/events-api";
import type {
  CreateEvent,
  DeleteEvent,
  ForkEvent,
  IssueCommentEvent,
  IssuesEvent,
  PullRequestEvent,
  PullRequestReviewCommentEvent,
  PullRequestReviewEvent,
  PushEvent,
  ReleaseEvent,
  WatchEvent,
  WorkflowRunEvent,
} from "../../../src/types/events-api";

describe("formatEvent", () => {
  const baseEvent = {
    id: "12345",
    actor: { login: "testuser" },
    repo: { name: "owner/repo" },
    created_at: "2024-01-01T00:00:00Z",
  };

  describe("PullRequestEvent", () => {
    test("formats opened PR", () => {
      const prDetailsMap = new Map<number, GitHubPullRequest>();
      prDetailsMap.set(123, {
        number: 123,
        title: "Add new feature",
        html_url: "https://github.com/owner/repo/pull/123",
        user: { login: "author" },
        merged: false,
        state: "open",
      });

      const event: PullRequestEvent = {
        ...baseEvent,
        type: "PullRequestEvent",
        payload: {
          action: "opened",
          number: 123,
          pull_request: { number: 123 },
        },
      };

      const result = formatEvent(event, prDetailsMap);
      expect(result).toContain("🔔");
      expect(result).toContain("Pull Request Opened");
      expect(result).toContain("owner/repo");
      expect(result).toContain("#123");
      expect(result).toContain("Add new feature");
      expect(result).toContain("testuser");
    });

    test("formats merged PR", () => {
      const prDetailsMap = new Map<number, GitHubPullRequest>();
      prDetailsMap.set(456, {
        number: 456,
        title: "Fix bug",
        html_url: "https://github.com/owner/repo/pull/456",
        user: { login: "author" },
        merged: true,
        state: "closed",
      });

      const event: PullRequestEvent = {
        ...baseEvent,
        type: "PullRequestEvent",
        payload: {
          action: "closed",
          number: 456,
          pull_request: { number: 456, merged: true },
        },
      };

      const result = formatEvent(event, prDetailsMap);
      expect(result).toContain("✅");
      expect(result).toContain("Pull Request Merged");
    });

    test("formats closed unmerged PR", () => {
      const prDetailsMap = new Map<number, GitHubPullRequest>();
      prDetailsMap.set(789, {
        number: 789,
        title: "WIP feature",
        html_url: "https://github.com/owner/repo/pull/789",
        user: { login: "author" },
        merged: false,
        state: "closed",
      });

      const event: PullRequestEvent = {
        ...baseEvent,
        type: "PullRequestEvent",
        payload: {
          action: "closed",
          number: 789,
          pull_request: { number: 789, merged: false },
        },
      };

      const result = formatEvent(event, prDetailsMap);
      expect(result).toContain("❌");
      expect(result).toContain("Pull Request Closed");
    });

    test("returns fallback when PR details missing", () => {
      const prDetailsMap = new Map<number, GitHubPullRequest>();

      const event: PullRequestEvent = {
        ...baseEvent,
        type: "PullRequestEvent",
        payload: {
          action: "opened",
          number: 999,
          pull_request: { number: 999 },
        },
      };

      const result = formatEvent(event, prDetailsMap);
      expect(result).toContain("Pull Request opened");
      expect(result).toContain("#999");
      expect(result).toContain("testuser");
    });

    test("returns empty string for other actions", () => {
      const event: PullRequestEvent = {
        ...baseEvent,
        type: "PullRequestEvent",
        payload: {
          action: "synchronize",
        },
      };

      const result = formatEvent(event, new Map());
      expect(result).toBe("");
    });
  });

  describe("IssuesEvent", () => {
    test("formats opened issue", () => {
      const event: IssuesEvent = {
        ...baseEvent,
        type: "IssuesEvent",
        payload: {
          action: "opened",
          issue: {
            number: 123,
            title: "Bug report",
            html_url: "https://github.com/owner/repo/issues/123",
            user: { login: "reporter" },
          },
        },
      };

      const result = formatEvent(event, new Map());
      expect(result).toContain("🐛");
      expect(result).toContain("Issue Opened");
      expect(result).toContain("Bug report");
      expect(result).toContain("#123");
    });

    test("formats closed issue", () => {
      const event: IssuesEvent = {
        ...baseEvent,
        type: "IssuesEvent",
        payload: {
          action: "closed",
          issue: {
            number: 456,
            title: "Fixed bug",
            html_url: "https://github.com/owner/repo/issues/456",
            user: { login: "reporter" },
          },
        },
      };

      const result = formatEvent(event, new Map());
      expect(result).toContain("✅");
      expect(result).toContain("Issue Closed");
    });

    test("returns empty string for other actions", () => {
      const event: IssuesEvent = {
        ...baseEvent,
        type: "IssuesEvent",
        payload: {
          action: "edited",
        },
      };

      const result = formatEvent(event, new Map());
      expect(result).toBe("");
    });
  });

  describe("PushEvent", () => {
    test("formats push with single commit", () => {
      const event: PushEvent = {
        ...baseEvent,
        type: "PushEvent",
        payload: {
          ref: "refs/heads/main",
          commits: [{ sha: "abc123def456", message: "Initial commit" }],
        },
      };

      const result = formatEvent(event, new Map());
      expect(result).toContain("📦");
      expect(result).toContain("Push to owner/repo");
      expect(result).toContain("main");
      expect(result).toContain("1 commit");
      expect(result).toContain("abc123d");
      expect(result).toContain("Initial commit");
    });

    test("formats push with multiple commits", () => {
      const event: PushEvent = {
        ...baseEvent,
        type: "PushEvent",
        payload: {
          ref: "refs/heads/feature",
          commits: [
            { sha: "abc123", message: "First commit" },
            { sha: "def456", message: "Second commit" },
            { sha: "ghi789", message: "Third commit" },
          ],
        },
      };

      const result = formatEvent(event, new Map());
      expect(result).toContain("3 commits");
      expect(result).toContain("feature");
    });

    test("truncates long commit messages", () => {
      const longMessage = "a".repeat(100);
      const event: PushEvent = {
        ...baseEvent,
        type: "PushEvent",
        payload: {
          ref: "refs/heads/main",
          commits: [{ sha: "abc123", message: longMessage }],
        },
      };

      const result = formatEvent(event, new Map());
      expect(result).toContain("...");
    });

    test("shows only first 3 commits with indicator", () => {
      const event: PushEvent = {
        ...baseEvent,
        type: "PushEvent",
        payload: {
          ref: "refs/heads/main",
          commits: [
            { sha: "a", message: "1" },
            { sha: "b", message: "2" },
            { sha: "c", message: "3" },
            { sha: "d", message: "4" },
            { sha: "e", message: "5" },
          ],
        },
      };

      const result = formatEvent(event, new Map());
      expect(result).toContain("... and 2 more commits");
    });

    test("returns empty string when no commits", () => {
      const event: PushEvent = {
        ...baseEvent,
        type: "PushEvent",
        payload: {
          ref: "refs/heads/main",
          commits: [],
        },
      };

      const result = formatEvent(event, new Map());
      expect(result).toBe("");
    });
  });

  describe("ReleaseEvent", () => {
    test("formats published release", () => {
      const event: ReleaseEvent = {
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

      const result = formatEvent(event, new Map());
      expect(result).toContain("🚀");
      expect(result).toContain("Release Published");
      expect(result).toContain("Version 1.0.0");
      expect(result).toContain("v1.0.0");
    });

    test("uses tag_name when name is null", () => {
      const event: ReleaseEvent = {
        ...baseEvent,
        type: "ReleaseEvent",
        payload: {
          action: "published",
          release: {
            tag_name: "v2.0.0",
            name: null,
            html_url: "https://github.com/owner/repo/releases/tag/v2.0.0",
            author: { login: "releaser" },
          },
        },
      };

      const result = formatEvent(event, new Map());
      expect(result).toContain("v2.0.0");
    });

    test("returns empty string for other actions", () => {
      const event: ReleaseEvent = {
        ...baseEvent,
        type: "ReleaseEvent",
        payload: {
          action: "created",
        },
      };

      const result = formatEvent(event, new Map());
      expect(result).toBe("");
    });
  });

  describe("WorkflowRunEvent", () => {
    test("formats successful workflow", () => {
      const event: WorkflowRunEvent = {
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

      const result = formatEvent(event, new Map());
      expect(result).toContain("✅");
      expect(result).toContain("CI Passed");
      expect(result).toContain("main");
    });

    test("formats failed workflow", () => {
      const event: WorkflowRunEvent = {
        ...baseEvent,
        type: "WorkflowRunEvent",
        payload: {
          action: "completed",
          workflow_run: {
            name: "Tests",
            conclusion: "failure",
            head_branch: "feature",
            html_url: "https://github.com/owner/repo/actions/runs/456",
          },
        },
      };

      const result = formatEvent(event, new Map());
      expect(result).toContain("❌");
      expect(result).toContain("CI Failed");
    });

    test("returns empty string for non-completed actions", () => {
      const event: WorkflowRunEvent = {
        ...baseEvent,
        type: "WorkflowRunEvent",
        payload: {
          action: "requested",
        },
      };

      const result = formatEvent(event, new Map());
      expect(result).toBe("");
    });
  });

  describe("IssueCommentEvent", () => {
    test("formats created comment", () => {
      const event: IssueCommentEvent = {
        ...baseEvent,
        type: "IssueCommentEvent",
        payload: {
          action: "created",
          issue: { number: 123 },
          comment: {
            body: "Great work!",
            html_url: "https://github.com/owner/repo/issues/123#comment-456",
            user: { login: "commenter" },
          },
        },
      };

      const result = formatEvent(event, new Map());
      expect(result).toContain("💬");
      expect(result).toContain("New Comment on Issue #123");
      expect(result).toContain("Great work!");
      expect(result).toContain("commenter");
    });

    test("truncates long comments", () => {
      const longComment = "a".repeat(150);
      const event: IssueCommentEvent = {
        ...baseEvent,
        type: "IssueCommentEvent",
        payload: {
          action: "created",
          issue: { number: 123 },
          comment: {
            body: longComment,
            html_url: "https://github.com/owner/repo/issues/123#comment-456",
            user: { login: "commenter" },
          },
        },
      };

      const result = formatEvent(event, new Map());
      expect(result).toContain("...");
    });

    test("returns empty string for other actions", () => {
      const event: IssueCommentEvent = {
        ...baseEvent,
        type: "IssueCommentEvent",
        payload: {
          action: "edited",
        },
      };

      const result = formatEvent(event, new Map());
      expect(result).toBe("");
    });
  });

  describe("PullRequestReviewEvent", () => {
    test("formats created review", () => {
      const prDetailsMap = new Map<number, GitHubPullRequest>();
      prDetailsMap.set(123, {
        number: 123,
        title: "Test PR",
        html_url: "https://github.com/owner/repo/pull/123",
        user: { login: "author" },
        merged: false,
        state: "open",
      });

      const event: PullRequestReviewEvent = {
        ...baseEvent,
        type: "PullRequestReviewEvent",
        payload: {
          action: "created",
          pull_request: { number: 123 },
          review: {
            state: "approved",
            html_url: "https://github.com/owner/repo/pull/123#review-456",
            user: { login: "reviewer" },
          },
        },
      };

      const result = formatEvent(event, prDetailsMap);
      expect(result).toContain("✅");
      expect(result).toContain("PR Review: approved");
      expect(result).toContain("Test PR");
    });

    test("formats review with changes requested", () => {
      const event: PullRequestReviewEvent = {
        ...baseEvent,
        type: "PullRequestReviewEvent",
        payload: {
          action: "created",
          pull_request: { number: 456 },
          review: {
            state: "changes_requested",
          },
        },
      };

      const result = formatEvent(event, new Map());
      expect(result).toContain("🔄");
      expect(result).toContain("changes requested");
    });

    test("uses fallback title when PR details missing", () => {
      const event: PullRequestReviewEvent = {
        ...baseEvent,
        type: "PullRequestReviewEvent",
        payload: {
          action: "created",
          pull_request: { number: 999 },
          review: { state: "commented" },
        },
      };

      const result = formatEvent(event, new Map());
      expect(result).toContain("PR #999");
    });

    test("returns empty string for other actions", () => {
      const event: PullRequestReviewEvent = {
        ...baseEvent,
        type: "PullRequestReviewEvent",
        payload: {
          action: "updated",
        },
      };

      const result = formatEvent(event, new Map());
      expect(result).toBe("");
    });
  });

  describe("CreateEvent", () => {
    test("formats branch creation", () => {
      const event: CreateEvent = {
        ...baseEvent,
        type: "CreateEvent",
        payload: {
          ref: "feature-branch",
          ref_type: "branch",
        },
      };

      const result = formatEvent(event, new Map());
      expect(result).toContain("🌿");
      expect(result).toContain("Branch Created");
      expect(result).toContain("feature-branch");
      expect(result).toContain("testuser");
    });

    test("formats tag creation", () => {
      const event: CreateEvent = {
        ...baseEvent,
        type: "CreateEvent",
        payload: {
          ref: "v1.0.0",
          ref_type: "tag",
        },
      };

      const result = formatEvent(event, new Map());
      expect(result).toContain("Tag Created");
    });

    test("returns empty string when ref missing", () => {
      const event: CreateEvent = {
        ...baseEvent,
        type: "CreateEvent",
        payload: {},
      };

      const result = formatEvent(event, new Map());
      expect(result).toBe("");
    });
  });

  describe("DeleteEvent", () => {
    test("formats branch deletion", () => {
      const event: DeleteEvent = {
        ...baseEvent,
        type: "DeleteEvent",
        payload: {
          ref: "old-branch",
          ref_type: "branch",
        },
      };

      const result = formatEvent(event, new Map());
      expect(result).toContain("🗑️");
      expect(result).toContain("Branch Deleted");
      expect(result).toContain("old-branch");
    });

    test("formats tag deletion", () => {
      const event: DeleteEvent = {
        ...baseEvent,
        type: "DeleteEvent",
        payload: {
          ref: "v0.1.0",
          ref_type: "tag",
        },
      };

      const result = formatEvent(event, new Map());
      expect(result).toContain("Tag Deleted");
    });
  });

  describe("PullRequestReviewCommentEvent", () => {
    test("formats created review comment", () => {
      const event: PullRequestReviewCommentEvent = {
        ...baseEvent,
        type: "PullRequestReviewCommentEvent",
        payload: {
          action: "created",
          pull_request: { number: 123 },
          comment: {
            body: "Please fix this line",
            html_url: "https://github.com/owner/repo/pull/123#comment-789",
            user: { login: "reviewer" },
          },
        },
      };

      const result = formatEvent(event, new Map());
      expect(result).toContain("💬");
      expect(result).toContain("Review Comment on PR #123");
      expect(result).toContain("Please fix this line");
      expect(result).toContain("reviewer");
    });

    test("uses actor when comment.user missing", () => {
      const event: PullRequestReviewCommentEvent = {
        ...baseEvent,
        type: "PullRequestReviewCommentEvent",
        payload: {
          action: "created",
          pull_request: { number: 123 },
          comment: {
            body: "Comment",
            html_url: "https://github.com/owner/repo/pull/123#comment-789",
          },
        },
      };

      const result = formatEvent(event, new Map());
      expect(result).toContain("testuser");
    });

    test("returns empty string for other actions", () => {
      const event: PullRequestReviewCommentEvent = {
        ...baseEvent,
        type: "PullRequestReviewCommentEvent",
        payload: {
          action: "edited",
        },
      };

      const result = formatEvent(event, new Map());
      expect(result).toBe("");
    });
  });

  describe("WatchEvent", () => {
    test("formats star notification", () => {
      const event: WatchEvent = {
        ...baseEvent,
        type: "WatchEvent",
        payload: {
          action: "started",
        },
      };

      const result = formatEvent(event, new Map());
      expect(result).toContain("⭐");
      expect(result).toContain("Repository Starred");
      expect(result).toContain("owner/repo");
      expect(result).toContain("testuser");
    });

    test("returns empty string for other actions", () => {
      const event: WatchEvent = {
        ...baseEvent,
        type: "WatchEvent",
        payload: {
          action: "stopped",
        },
      };

      const result = formatEvent(event, new Map());
      expect(result).toBe("");
    });
  });

  describe("ForkEvent", () => {
    test("formats fork notification", () => {
      const event: ForkEvent = {
        ...baseEvent,
        type: "ForkEvent",
        payload: {
          forkee: {
            full_name: "testuser/new-repo",
            html_url: "https://github.com/testuser/new-repo",
          },
        },
      };

      const result = formatEvent(event, new Map());
      expect(result).toContain("🍴");
      expect(result).toContain("Repository Forked");
      expect(result).toContain("testuser/new-repo");
      expect(result).toContain("https://github.com/testuser/new-repo");
    });

    test("returns empty string when forkee missing", () => {
      const event: ForkEvent = {
        ...baseEvent,
        type: "ForkEvent",
        payload: {},
      };

      const result = formatEvent(event, new Map());
      expect(result).toBe("");
    });
  });
});
