import { describe, expect, test, beforeEach, spyOn } from "bun:test";
import { handleGhIssues } from "../../../src/handlers/gh-issues-handler";
import { createMockBotHandler } from "../../fixtures/mock-bot-handler";
import {
  mockIssueListResponse,
  mockIssueListWithPullRequestsResponse,
} from "../../fixtures/github-payloads";
import * as githubClient from "../../../src/api/github-client";

describe("gh_issues handler", () => {
  let mockHandler: ReturnType<typeof createMockBotHandler>;

  beforeEach(() => {
    mockHandler = createMockBotHandler();
    mockHandler.sendMessage.mockClear();
  });

  test("should send error for missing arguments", async () => {
    await handleGhIssues(mockHandler, {
      channelId: "test-channel",
      args: [],
    });

    expect(mockHandler.sendMessage).toHaveBeenCalledTimes(1);
    expect(mockHandler.sendMessage).toHaveBeenCalledWith(
      "test-channel",
      "❌ Usage: `/gh_issues owner/repo [count]`\n\nExample: `/gh_issues facebook/react 5`"
    );
  });

  test("should use default count of 10 when not specified", async () => {
    const listIssuesSpy = spyOn(githubClient, "listIssues").mockResolvedValue(
      mockIssueListResponse
    );

    await handleGhIssues(mockHandler, {
      channelId: "test-channel",
      args: ["owner/repo"],
    });

    expect(listIssuesSpy).toHaveBeenCalledWith("owner/repo", 10);

    listIssuesSpy.mockRestore();
  });

  test("should use custom count when specified", async () => {
    const listIssuesSpy = spyOn(githubClient, "listIssues").mockResolvedValue(
      mockIssueListResponse
    );

    await handleGhIssues(mockHandler, {
      channelId: "test-channel",
      args: ["owner/repo", "5"],
    });

    expect(listIssuesSpy).toHaveBeenCalledWith("owner/repo", 5);

    listIssuesSpy.mockRestore();
  });

  test("should send error for invalid count (NaN)", async () => {
    await handleGhIssues(mockHandler, {
      channelId: "test-channel",
      args: ["owner/repo", "invalid"],
    });

    expect(mockHandler.sendMessage).toHaveBeenCalledWith(
      "test-channel",
      "❌ Count must be a number between 1 and 50"
    );
  });

  test("should send error for count < 1", async () => {
    await handleGhIssues(mockHandler, {
      channelId: "test-channel",
      args: ["owner/repo", "0"],
    });

    expect(mockHandler.sendMessage).toHaveBeenCalledWith(
      "test-channel",
      "❌ Count must be a number between 1 and 50"
    );
  });

  test("should send error for count > 50", async () => {
    await handleGhIssues(mockHandler, {
      channelId: "test-channel",
      args: ["owner/repo", "100"],
    });

    expect(mockHandler.sendMessage).toHaveBeenCalledWith(
      "test-channel",
      "❌ Count must be a number between 1 and 50"
    );
  });

  test("should fetch and display list of issues with hyperlinks", async () => {
    const listIssuesSpy = spyOn(githubClient, "listIssues").mockResolvedValue(
      mockIssueListResponse
    );

    await handleGhIssues(mockHandler, {
      channelId: "test-channel",
      args: ["owner/repo"],
    });

    expect(listIssuesSpy).toHaveBeenCalledWith("owner/repo", 10);
    expect(mockHandler.sendMessage).toHaveBeenCalledTimes(1);

    const sentMessage = mockHandler.sendMessage.mock.calls[0][1];
    expect(sentMessage).toContain("**Recent Issues - owner/repo**");
    expect(sentMessage).toContain("Showing 3 most recent issues:");

    // Check for hyperlinked issue numbers
    expect(sentMessage).toContain(
      "[#50](https://github.com/owner/repo/issues/50)"
    );
    expect(sentMessage).toContain(
      "[#49](https://github.com/owner/repo/issues/49)"
    );
    expect(sentMessage).toContain(
      "[#48](https://github.com/owner/repo/issues/48)"
    );

    // Check for issue titles and authors
    expect(sentMessage).toContain("**Bug: App crashes on startup**");
    expect(sentMessage).toContain("by user1");
    expect(sentMessage).toContain("**Feature request: Add dark mode**");
    expect(sentMessage).toContain("by user2");
    expect(sentMessage).toContain("**Question about API usage**");
    expect(sentMessage).toContain("by user3");

    // Check for status indicators
    expect(sentMessage).toContain("🟢 Open");
    expect(sentMessage).toContain("✅ Closed");

    listIssuesSpy.mockRestore();
  });

  test("should filter out pull requests from issues list", async () => {
    const listIssuesSpy = spyOn(githubClient, "listIssues").mockResolvedValue(
      mockIssueListWithPullRequestsResponse
    );

    await handleGhIssues(mockHandler, {
      channelId: "test-channel",
      args: ["owner/repo"],
    });

    const sentMessage = mockHandler.sendMessage.mock.calls[0][1];

    // Should show the real issue
    expect(sentMessage).toContain(
      "[#52](https://github.com/owner/repo/issues/52)"
    );
    expect(sentMessage).toContain("**Real issue here**");

    // Should NOT show the PR
    expect(sentMessage).not.toContain("#51");
    expect(sentMessage).not.toContain("This is actually a PR");

    // Should show correct count
    expect(sentMessage).toContain("Showing 1 most recent issues:");

    listIssuesSpy.mockRestore();
  });

  test("should handle when all items are PRs (no actual issues)", async () => {
    const onlyPRs = [
      {
        number: 51,
        title: "This is actually a PR",
        state: "open" as const,
        user: { login: "developer1" },
        html_url: "https://github.com/owner/repo/pull/51",
        pull_request: {
          url: "https://api.github.com/repos/owner/repo/pulls/51",
        },
        labels: [],
        comments: 0,
      },
    ];

    const listIssuesSpy = spyOn(githubClient, "listIssues").mockResolvedValue(
      onlyPRs
    );

    await handleGhIssues(mockHandler, {
      channelId: "test-channel",
      args: ["owner/repo"],
    });

    expect(mockHandler.sendMessage).toHaveBeenCalledWith(
      "test-channel",
      "No issues found for **owner/repo** (only PRs available)"
    );

    listIssuesSpy.mockRestore();
  });

  test("should handle empty issues list", async () => {
    const listIssuesSpy = spyOn(githubClient, "listIssues").mockResolvedValue(
      []
    );

    await handleGhIssues(mockHandler, {
      channelId: "test-channel",
      args: ["owner/repo"],
    });

    expect(mockHandler.sendMessage).toHaveBeenCalledWith(
      "test-channel",
      "No issues found for **owner/repo**"
    );

    listIssuesSpy.mockRestore();
  });

  test("should handle GitHub API errors", async () => {
    const error = new Error("GitHub API error: 404 Not Found");
    const listIssuesSpy = spyOn(githubClient, "listIssues").mockRejectedValue(
      error
    );

    await handleGhIssues(mockHandler, {
      channelId: "test-channel",
      args: ["owner/repo"],
    });

    expect(mockHandler.sendMessage).toHaveBeenCalledWith(
      "test-channel",
      "❌ Error: GitHub API error: 404 Not Found"
    );

    listIssuesSpy.mockRestore();
  });

  test("should strip markdown formatting from repo name", async () => {
    const listIssuesSpy = spyOn(githubClient, "listIssues").mockResolvedValue(
      mockIssueListResponse
    );

    await handleGhIssues(mockHandler, {
      channelId: "test-channel",
      args: ["**owner/repo**", "5"],
    });

    expect(listIssuesSpy).toHaveBeenCalledWith("owner/repo", 5);

    listIssuesSpy.mockRestore();
  });

  test("should strip markdown code formatting from arguments", async () => {
    const listIssuesSpy = spyOn(githubClient, "listIssues").mockResolvedValue(
      mockIssueListResponse
    );

    await handleGhIssues(mockHandler, {
      channelId: "test-channel",
      args: ["`owner/repo`", "`5`"],
    });

    expect(listIssuesSpy).toHaveBeenCalledWith("owner/repo", 5);

    listIssuesSpy.mockRestore();
  });

  test("should preserve underscores in repo names", async () => {
    const listIssuesSpy = spyOn(githubClient, "listIssues").mockResolvedValue(
      mockIssueListResponse
    );

    await handleGhIssues(mockHandler, {
      channelId: "test-channel",
      args: ["**my__repo__name**"],
    });

    expect(listIssuesSpy).toHaveBeenCalledWith("my__repo__name", 10);

    listIssuesSpy.mockRestore();
  });
});
