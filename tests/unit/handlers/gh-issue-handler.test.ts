import { beforeEach, describe, expect, spyOn, test } from "bun:test";

import * as githubClient from "../../../src/api/github-client";
import { handleGhIssue } from "../../../src/handlers/gh-issue-handler";
import {
  mockClosedIssueResponse,
  mockIssueListResponse,
  mockIssueListWithPullRequestsResponse,
  mockIssueResponse,
  mockIssueWithoutLabelsResponse,
} from "../../fixtures/github-payloads";
import { createMockBotHandler } from "../../fixtures/mock-bot-handler";

describe("gh_issue handler - show single issue", () => {
  let mockHandler: ReturnType<typeof createMockBotHandler>;

  beforeEach(() => {
    mockHandler = createMockBotHandler();
    mockHandler.sendMessage.mockClear();
  });

  test("should send error for missing arguments", async () => {
    await handleGhIssue(mockHandler, {
      channelId: "test-channel",
      args: [],
    });

    expect(mockHandler.sendMessage).toHaveBeenCalledTimes(1);
    expect(mockHandler.sendMessage).toHaveBeenCalledWith(
      "test-channel",
      expect.stringContaining("❌ Usage: `/gh_issue owner/repo #123")
    );
  });

  test("should send error for only one argument", async () => {
    await handleGhIssue(mockHandler, {
      channelId: "test-channel",
      args: ["owner/repo"],
    });

    expect(mockHandler.sendMessage).toHaveBeenCalledTimes(1);
    expect(mockHandler.sendMessage).toHaveBeenCalledWith(
      "test-channel",
      expect.stringContaining("❌ Usage: `/gh_issue owner/repo #123")
    );
  });

  test("should fetch and display issue details with # prefix", async () => {
    const getIssueSpy = spyOn(githubClient, "getIssue").mockResolvedValue(
      mockIssueResponse
    );

    await handleGhIssue(mockHandler, {
      channelId: "test-channel",
      args: ["owner/repo", "#123"],
    });

    expect(getIssueSpy).toHaveBeenCalledWith("owner/repo", "123");
    expect(mockHandler.sendMessage).toHaveBeenCalledTimes(1);

    const sentMessage = mockHandler.sendMessage.mock.calls[0][1];
    expect(sentMessage).toContain("**Issue #123**");
    expect(sentMessage).toContain("**owner/repo**");
    expect(sentMessage).toContain("**Test issue title**");
    expect(sentMessage).toContain("🟢 Open");
    expect(sentMessage).toContain("👤 Author: testuser");
    expect(sentMessage).toContain("💬 Comments: 5");
    expect(sentMessage).toContain("🏷️ Labels: bug, priority:high");
    expect(sentMessage).toContain("https://github.com/owner/repo/issues/123");

    getIssueSpy.mockRestore();
  });

  test("should fetch and display issue details without # prefix", async () => {
    const getIssueSpy = spyOn(githubClient, "getIssue").mockResolvedValue(
      mockIssueResponse
    );

    await handleGhIssue(mockHandler, {
      channelId: "test-channel",
      args: ["owner/repo", "123"],
    });

    expect(getIssueSpy).toHaveBeenCalledWith("owner/repo", "123");
    expect(mockHandler.sendMessage).toHaveBeenCalledTimes(1);

    getIssueSpy.mockRestore();
  });

  test("should display closed status for closed issues", async () => {
    const getIssueSpy = spyOn(githubClient, "getIssue").mockResolvedValue(
      mockClosedIssueResponse
    );

    await handleGhIssue(mockHandler, {
      channelId: "test-channel",
      args: ["owner/repo", "124"],
    });

    const sentMessage = mockHandler.sendMessage.mock.calls[0][1];
    expect(sentMessage).toContain("✅ Closed");

    getIssueSpy.mockRestore();
  });

  test("should omit labels line when no labels exist", async () => {
    const getIssueSpy = spyOn(githubClient, "getIssue").mockResolvedValue(
      mockIssueWithoutLabelsResponse
    );

    await handleGhIssue(mockHandler, {
      channelId: "test-channel",
      args: ["owner/repo", "125"],
    });

    const sentMessage = mockHandler.sendMessage.mock.calls[0][1];
    expect(sentMessage).not.toContain("🏷️ Labels:");

    getIssueSpy.mockRestore();
  });

  test("should handle GitHub API errors", async () => {
    const error = new Error("GitHub API error: 404 Not Found");
    const getIssueSpy = spyOn(githubClient, "getIssue").mockRejectedValue(
      error
    );

    await handleGhIssue(mockHandler, {
      channelId: "test-channel",
      args: ["owner/repo", "999"],
    });

    expect(mockHandler.sendMessage).toHaveBeenCalledWith(
      "test-channel",
      "❌ Error: GitHub API error: 404 Not Found"
    );

    getIssueSpy.mockRestore();
  });

  test("should handle malformed repository names", async () => {
    const error = new Error("GitHub API error: 400 Bad Request");
    const getIssueSpy = spyOn(githubClient, "getIssue").mockRejectedValue(
      error
    );

    await handleGhIssue(mockHandler, {
      channelId: "test-channel",
      args: ["invalid-repo-name", "123"],
    });

    expect(mockHandler.sendMessage).toHaveBeenCalledWith(
      "test-channel",
      "❌ Error: GitHub API error: 400 Bad Request"
    );

    getIssueSpy.mockRestore();
  });

  test("should format labels correctly with multiple labels", async () => {
    const multiLabelIssue = {
      ...mockIssueResponse,
      labels: [
        { name: "bug" },
        { name: "enhancement" },
        { name: "help wanted" },
      ],
    };
    const getIssueSpy = spyOn(githubClient, "getIssue").mockResolvedValue(
      multiLabelIssue
    );

    await handleGhIssue(mockHandler, {
      channelId: "test-channel",
      args: ["owner/repo", "123"],
    });

    const sentMessage = mockHandler.sendMessage.mock.calls[0][1];
    expect(sentMessage).toContain("🏷️ Labels: bug, enhancement, help wanted");

    getIssueSpy.mockRestore();
  });

  test("should strip markdown bold formatting from repo name", async () => {
    const getIssueSpy = spyOn(githubClient, "getIssue").mockResolvedValue(
      mockIssueResponse
    );

    await handleGhIssue(mockHandler, {
      channelId: "test-channel",
      args: ["**owner/repo**", "123"],
    });

    expect(getIssueSpy).toHaveBeenCalledWith("owner/repo", "123");

    getIssueSpy.mockRestore();
  });

  test("should strip markdown italic formatting from issue number", async () => {
    const getIssueSpy = spyOn(githubClient, "getIssue").mockResolvedValue(
      mockIssueResponse
    );

    await handleGhIssue(mockHandler, {
      channelId: "test-channel",
      args: ["owner/repo", "*123*"],
    });

    expect(getIssueSpy).toHaveBeenCalledWith("owner/repo", "123");

    getIssueSpy.mockRestore();
  });

  test("should strip markdown code formatting from arguments", async () => {
    const getIssueSpy = spyOn(githubClient, "getIssue").mockResolvedValue(
      mockIssueResponse
    );

    await handleGhIssue(mockHandler, {
      channelId: "test-channel",
      args: ["`owner/repo`", "`#123`"],
    });

    expect(getIssueSpy).toHaveBeenCalledWith("owner/repo", "123");

    getIssueSpy.mockRestore();
  });

  test("should strip multiple markdown formats from arguments", async () => {
    const getIssueSpy = spyOn(githubClient, "getIssue").mockResolvedValue(
      mockIssueResponse
    );

    await handleGhIssue(mockHandler, {
      channelId: "test-channel",
      args: ["**`owner/repo`**", "~~#123~~"],
    });

    expect(getIssueSpy).toHaveBeenCalledWith("owner/repo", "123");

    getIssueSpy.mockRestore();
  });

  test("should preserve underscores in repo names", async () => {
    const getIssueSpy = spyOn(githubClient, "getIssue").mockResolvedValue(
      mockIssueResponse
    );

    await handleGhIssue(mockHandler, {
      channelId: "test-channel",
      args: ["**my__repo__name**", "123"],
    });

    // Underscores should be preserved (valid in GitHub repo names)
    expect(getIssueSpy).toHaveBeenCalledWith("my__repo__name", "123");

    getIssueSpy.mockRestore();
  });
});

describe("gh_issue handler - list subcommand", () => {
  let mockHandler: ReturnType<typeof createMockBotHandler>;

  beforeEach(() => {
    mockHandler = createMockBotHandler();
    mockHandler.sendMessage.mockClear();
  });

  test("should send error for missing arguments with list subcommand", async () => {
    await handleGhIssue(mockHandler, {
      channelId: "test-channel",
      args: ["list"],
    });

    expect(mockHandler.sendMessage).toHaveBeenCalledTimes(1);
    expect(mockHandler.sendMessage).toHaveBeenCalledWith(
      "test-channel",
      expect.stringContaining("❌ Usage: `/gh_issue list owner/repo")
    );
  });

  test("should use default count of 10 when not specified", async () => {
    const listIssuesSpy = spyOn(githubClient, "listIssues").mockResolvedValue(
      mockIssueListResponse
    );

    await handleGhIssue(mockHandler, {
      channelId: "test-channel",
      args: ["list", "owner/repo"],
    });

    expect(listIssuesSpy).toHaveBeenCalledWith("owner/repo", 10, {});

    listIssuesSpy.mockRestore();
  });

  test("should use custom count when specified", async () => {
    const listIssuesSpy = spyOn(githubClient, "listIssues").mockResolvedValue(
      mockIssueListResponse
    );

    await handleGhIssue(mockHandler, {
      channelId: "test-channel",
      args: ["list", "owner/repo", "5"],
    });

    expect(listIssuesSpy).toHaveBeenCalledWith("owner/repo", 5, {});

    listIssuesSpy.mockRestore();
  });

  test("should send error for invalid count (NaN)", async () => {
    await handleGhIssue(mockHandler, {
      channelId: "test-channel",
      args: ["list", "owner/repo", "invalid"],
    });

    expect(mockHandler.sendMessage).toHaveBeenCalledWith(
      "test-channel",
      "❌ Count must be a number between 1 and 50"
    );
  });

  test("should send error for count < 1", async () => {
    await handleGhIssue(mockHandler, {
      channelId: "test-channel",
      args: ["list", "owner/repo", "0"],
    });

    expect(mockHandler.sendMessage).toHaveBeenCalledWith(
      "test-channel",
      "❌ Count must be a number between 1 and 50"
    );
  });

  test("should send error for count > 50", async () => {
    await handleGhIssue(mockHandler, {
      channelId: "test-channel",
      args: ["list", "owner/repo", "100"],
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

    await handleGhIssue(mockHandler, {
      channelId: "test-channel",
      args: ["list", "owner/repo"],
    });

    expect(listIssuesSpy).toHaveBeenCalledWith("owner/repo", 10, {});
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
    // listIssues now filters out PRs internally, so mock only returns actual issues
    const onlyActualIssues = mockIssueListWithPullRequestsResponse.filter(
      item => !item.pull_request
    );
    const listIssuesSpy = spyOn(githubClient, "listIssues").mockResolvedValue(
      onlyActualIssues
    );

    await handleGhIssue(mockHandler, {
      channelId: "test-channel",
      args: ["list", "owner/repo"],
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
    // listIssues now filters out PRs internally, so it returns empty array
    const listIssuesSpy = spyOn(githubClient, "listIssues").mockResolvedValue(
      []
    );

    await handleGhIssue(mockHandler, {
      channelId: "test-channel",
      args: ["list", "owner/repo"],
    });

    expect(mockHandler.sendMessage).toHaveBeenCalledWith(
      "test-channel",
      "No issues found for **owner/repo**"
    );

    listIssuesSpy.mockRestore();
  });

  test("should handle empty issues list", async () => {
    const listIssuesSpy = spyOn(githubClient, "listIssues").mockResolvedValue(
      []
    );

    await handleGhIssue(mockHandler, {
      channelId: "test-channel",
      args: ["list", "owner/repo"],
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

    await handleGhIssue(mockHandler, {
      channelId: "test-channel",
      args: ["list", "owner/repo"],
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

    await handleGhIssue(mockHandler, {
      channelId: "test-channel",
      args: ["list", "**owner/repo**", "5"],
    });

    expect(listIssuesSpy).toHaveBeenCalledWith("owner/repo", 5, {});

    listIssuesSpy.mockRestore();
  });

  test("should strip markdown code formatting from arguments", async () => {
    const listIssuesSpy = spyOn(githubClient, "listIssues").mockResolvedValue(
      mockIssueListResponse
    );

    await handleGhIssue(mockHandler, {
      channelId: "test-channel",
      args: ["list", "`owner/repo`", "`5`"],
    });

    expect(listIssuesSpy).toHaveBeenCalledWith("owner/repo", 5, {});

    listIssuesSpy.mockRestore();
  });

  test("should preserve underscores in repo names", async () => {
    const listIssuesSpy = spyOn(githubClient, "listIssues").mockResolvedValue(
      mockIssueListResponse
    );

    await handleGhIssue(mockHandler, {
      channelId: "test-channel",
      args: ["list", "**my__repo__name**"],
    });

    expect(listIssuesSpy).toHaveBeenCalledWith("my__repo__name", 10, {});

    listIssuesSpy.mockRestore();
  });
});
