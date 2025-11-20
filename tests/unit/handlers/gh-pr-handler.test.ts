import { beforeEach, describe, expect, spyOn, test } from "bun:test";

import * as githubClient from "../../../src/api/github-client";
import { handleGhPr } from "../../../src/handlers/gh-pr-handler";
import {
  mockClosedPullRequestResponse,
  mockMergedPullRequestResponse,
  mockPullRequestListResponse,
  mockPullRequestResponse,
} from "../../fixtures/github-payloads";
import { createMockBotHandler } from "../../fixtures/mock-bot-handler";

describe("gh_pr handler - show single PR", () => {
  let mockHandler: ReturnType<typeof createMockBotHandler>;

  beforeEach(() => {
    mockHandler = createMockBotHandler();
    mockHandler.sendMessage.mockClear();
  });

  test("should send error for missing arguments", async () => {
    await handleGhPr(mockHandler, {
      channelId: "test-channel",
      args: [],
    });

    expect(mockHandler.sendMessage).toHaveBeenCalledTimes(1);
    expect(mockHandler.sendMessage).toHaveBeenCalledWith(
      "test-channel",
      expect.stringContaining("❌ Usage: `/gh_pr owner/repo #123")
    );
  });

  test("should send error for only one argument", async () => {
    await handleGhPr(mockHandler, {
      channelId: "test-channel",
      args: ["owner/repo"],
    });

    expect(mockHandler.sendMessage).toHaveBeenCalledTimes(1);
    expect(mockHandler.sendMessage).toHaveBeenCalledWith(
      "test-channel",
      expect.stringContaining("❌ Usage: `/gh_pr owner/repo #123")
    );
  });

  test("should fetch and display PR details with # prefix", async () => {
    const getPRSpy = spyOn(githubClient, "getPullRequest").mockResolvedValue(
      mockPullRequestResponse
    );

    await handleGhPr(mockHandler, {
      channelId: "test-channel",
      args: ["owner/repo", "#456"],
    });

    expect(getPRSpy).toHaveBeenCalledWith("owner/repo", "456");
    expect(mockHandler.sendMessage).toHaveBeenCalledTimes(1);

    const sentMessage = mockHandler.sendMessage.mock.calls[0][1];
    expect(sentMessage).toContain("**Pull Request #456**");
    expect(sentMessage).toContain("**owner/repo**");
    expect(sentMessage).toContain("**Test PR title**");
    expect(sentMessage).toContain("🟢 Open");
    expect(sentMessage).toContain("👤 Author: testuser");
    expect(sentMessage).toContain("📝 Changes: +100 -50");
    expect(sentMessage).toContain("💬 Comments: 3");
    expect(sentMessage).toContain("https://github.com/owner/repo/pull/456");

    getPRSpy.mockRestore();
  });

  test("should fetch and display PR details without # prefix", async () => {
    const getPRSpy = spyOn(githubClient, "getPullRequest").mockResolvedValue(
      mockPullRequestResponse
    );

    await handleGhPr(mockHandler, {
      channelId: "test-channel",
      args: ["owner/repo", "456"],
    });

    expect(getPRSpy).toHaveBeenCalledWith("owner/repo", "456");
    expect(mockHandler.sendMessage).toHaveBeenCalledTimes(1);

    getPRSpy.mockRestore();
  });

  test("should display merged status for merged PRs", async () => {
    const getPRSpy = spyOn(githubClient, "getPullRequest").mockResolvedValue(
      mockMergedPullRequestResponse
    );

    await handleGhPr(mockHandler, {
      channelId: "test-channel",
      args: ["owner/repo", "457"],
    });

    const sentMessage = mockHandler.sendMessage.mock.calls[0][1];
    expect(sentMessage).toContain("✅ Merged");

    getPRSpy.mockRestore();
  });

  test("should display closed status for closed (not merged) PRs", async () => {
    const getPRSpy = spyOn(githubClient, "getPullRequest").mockResolvedValue(
      mockClosedPullRequestResponse
    );

    await handleGhPr(mockHandler, {
      channelId: "test-channel",
      args: ["owner/repo", "458"],
    });

    const sentMessage = mockHandler.sendMessage.mock.calls[0][1];
    expect(sentMessage).toContain("❌ Closed");

    getPRSpy.mockRestore();
  });

  test("should handle GitHub API errors", async () => {
    const error = new Error("GitHub API error: 404 Not Found");
    const getPRSpy = spyOn(githubClient, "getPullRequest").mockRejectedValue(
      error
    );

    await handleGhPr(mockHandler, {
      channelId: "test-channel",
      args: ["owner/repo", "999"],
    });

    expect(mockHandler.sendMessage).toHaveBeenCalledWith(
      "test-channel",
      "❌ Error: GitHub API error: 404 Not Found"
    );

    getPRSpy.mockRestore();
  });

  test("should handle malformed repository names", async () => {
    const error = new Error("GitHub API error: 400 Bad Request");
    const getPRSpy = spyOn(githubClient, "getPullRequest").mockRejectedValue(
      error
    );

    await handleGhPr(mockHandler, {
      channelId: "test-channel",
      args: ["invalid-repo-name", "123"],
    });

    expect(mockHandler.sendMessage).toHaveBeenCalledWith(
      "test-channel",
      "❌ Error: GitHub API error: 400 Bad Request"
    );

    getPRSpy.mockRestore();
  });

  test("should strip markdown bold formatting from repo name", async () => {
    const getPRSpy = spyOn(githubClient, "getPullRequest").mockResolvedValue(
      mockPullRequestResponse
    );

    await handleGhPr(mockHandler, {
      channelId: "test-channel",
      args: ["**owner/repo**", "456"],
    });

    expect(getPRSpy).toHaveBeenCalledWith("owner/repo", "456");

    getPRSpy.mockRestore();
  });

  test("should strip markdown italic formatting from PR number", async () => {
    const getPRSpy = spyOn(githubClient, "getPullRequest").mockResolvedValue(
      mockPullRequestResponse
    );

    await handleGhPr(mockHandler, {
      channelId: "test-channel",
      args: ["owner/repo", "*456*"],
    });

    expect(getPRSpy).toHaveBeenCalledWith("owner/repo", "456");

    getPRSpy.mockRestore();
  });

  test("should strip markdown code formatting from arguments", async () => {
    const getPRSpy = spyOn(githubClient, "getPullRequest").mockResolvedValue(
      mockPullRequestResponse
    );

    await handleGhPr(mockHandler, {
      channelId: "test-channel",
      args: ["`owner/repo`", "`#456`"],
    });

    expect(getPRSpy).toHaveBeenCalledWith("owner/repo", "456");

    getPRSpy.mockRestore();
  });

  test("should strip multiple markdown formats from arguments", async () => {
    const getPRSpy = spyOn(githubClient, "getPullRequest").mockResolvedValue(
      mockPullRequestResponse
    );

    await handleGhPr(mockHandler, {
      channelId: "test-channel",
      args: ["**`owner/repo`**", "~~#456~~"],
    });

    expect(getPRSpy).toHaveBeenCalledWith("owner/repo", "456");

    getPRSpy.mockRestore();
  });

  test("should preserve underscores in repo names", async () => {
    const getPRSpy = spyOn(githubClient, "getPullRequest").mockResolvedValue(
      mockPullRequestResponse
    );

    await handleGhPr(mockHandler, {
      channelId: "test-channel",
      args: ["**my__repo__name**", "456"],
    });

    // Underscores should be preserved (valid in GitHub repo names)
    expect(getPRSpy).toHaveBeenCalledWith("my__repo__name", "456");

    getPRSpy.mockRestore();
  });
});

describe("gh_pr handler - list subcommand", () => {
  let mockHandler: ReturnType<typeof createMockBotHandler>;

  beforeEach(() => {
    mockHandler = createMockBotHandler();
    mockHandler.sendMessage.mockClear();
  });

  test("should send error for missing arguments with list subcommand", async () => {
    await handleGhPr(mockHandler, {
      channelId: "test-channel",
      args: ["list"],
    });

    expect(mockHandler.sendMessage).toHaveBeenCalledTimes(1);
    expect(mockHandler.sendMessage).toHaveBeenCalledWith(
      "test-channel",
      expect.stringContaining("❌ Usage: `/gh_pr list owner/repo")
    );
  });

  test("should use default count of 10 when not specified", async () => {
    const listPRsSpy = spyOn(
      githubClient,
      "listPullRequests"
    ).mockResolvedValue(mockPullRequestListResponse);

    await handleGhPr(mockHandler, {
      channelId: "test-channel",
      args: ["list", "owner/repo"],
    });

    expect(listPRsSpy).toHaveBeenCalledWith("owner/repo", 10, {});

    listPRsSpy.mockRestore();
  });

  test("should use custom count when specified", async () => {
    const listPRsSpy = spyOn(
      githubClient,
      "listPullRequests"
    ).mockResolvedValue(mockPullRequestListResponse);

    await handleGhPr(mockHandler, {
      channelId: "test-channel",
      args: ["list", "owner/repo", "5"],
    });

    expect(listPRsSpy).toHaveBeenCalledWith("owner/repo", 5, {});

    listPRsSpy.mockRestore();
  });

  test("should send error for invalid count (NaN)", async () => {
    await handleGhPr(mockHandler, {
      channelId: "test-channel",
      args: ["list", "owner/repo", "invalid"],
    });

    expect(mockHandler.sendMessage).toHaveBeenCalledWith(
      "test-channel",
      "❌ Count must be a number between 1 and 50"
    );
  });

  test("should send error for count < 1", async () => {
    await handleGhPr(mockHandler, {
      channelId: "test-channel",
      args: ["list", "owner/repo", "0"],
    });

    expect(mockHandler.sendMessage).toHaveBeenCalledWith(
      "test-channel",
      "❌ Count must be a number between 1 and 50"
    );
  });

  test("should send error for count > 50", async () => {
    await handleGhPr(mockHandler, {
      channelId: "test-channel",
      args: ["list", "owner/repo", "100"],
    });

    expect(mockHandler.sendMessage).toHaveBeenCalledWith(
      "test-channel",
      "❌ Count must be a number between 1 and 50"
    );
  });

  test("should fetch and display list of PRs with hyperlinks", async () => {
    const listPRsSpy = spyOn(
      githubClient,
      "listPullRequests"
    ).mockResolvedValue(mockPullRequestListResponse);

    await handleGhPr(mockHandler, {
      channelId: "test-channel",
      args: ["list", "owner/repo"],
    });

    expect(listPRsSpy).toHaveBeenCalledWith("owner/repo", 10, {});
    expect(mockHandler.sendMessage).toHaveBeenCalledTimes(1);

    const sentMessage = mockHandler.sendMessage.mock.calls[0][1];
    expect(sentMessage).toContain("**Recent Pull Requests - owner/repo**");
    expect(sentMessage).toContain("Showing 3 most recent PRs:");

    // Check for hyperlinked PR numbers
    expect(sentMessage).toContain(
      "[#100](https://github.com/owner/repo/pull/100)"
    );
    expect(sentMessage).toContain(
      "[#99](https://github.com/owner/repo/pull/99)"
    );
    expect(sentMessage).toContain(
      "[#98](https://github.com/owner/repo/pull/98)"
    );

    // Check for PR titles and authors
    expect(sentMessage).toContain("**Add new feature X**");
    expect(sentMessage).toContain("by developer1");
    expect(sentMessage).toContain("**Fix bug in component Y**");
    expect(sentMessage).toContain("by developer2");
    expect(sentMessage).toContain("**Update documentation**");
    expect(sentMessage).toContain("by developer3");

    // Check for status indicators
    expect(sentMessage).toContain("🟢 Open");
    expect(sentMessage).toContain("✅ Merged");
    expect(sentMessage).toContain("❌ Closed");

    listPRsSpy.mockRestore();
  });

  test("should handle empty PR list", async () => {
    const listPRsSpy = spyOn(
      githubClient,
      "listPullRequests"
    ).mockResolvedValue([]);

    await handleGhPr(mockHandler, {
      channelId: "test-channel",
      args: ["list", "owner/repo"],
    });

    expect(mockHandler.sendMessage).toHaveBeenCalledWith(
      "test-channel",
      "No pull requests found for **owner/repo**"
    );

    listPRsSpy.mockRestore();
  });

  test("should handle GitHub API errors", async () => {
    const error = new Error("GitHub API error: 404 Not Found");
    const listPRsSpy = spyOn(
      githubClient,
      "listPullRequests"
    ).mockRejectedValue(error);

    await handleGhPr(mockHandler, {
      channelId: "test-channel",
      args: ["list", "owner/repo"],
    });

    expect(mockHandler.sendMessage).toHaveBeenCalledWith(
      "test-channel",
      "❌ Error: GitHub API error: 404 Not Found"
    );

    listPRsSpy.mockRestore();
  });

  test("should strip markdown formatting from repo name", async () => {
    const listPRsSpy = spyOn(
      githubClient,
      "listPullRequests"
    ).mockResolvedValue(mockPullRequestListResponse);

    await handleGhPr(mockHandler, {
      channelId: "test-channel",
      args: ["list", "**owner/repo**", "5"],
    });

    expect(listPRsSpy).toHaveBeenCalledWith("owner/repo", 5, {});

    listPRsSpy.mockRestore();
  });

  test("should strip markdown code formatting from arguments", async () => {
    const listPRsSpy = spyOn(
      githubClient,
      "listPullRequests"
    ).mockResolvedValue(mockPullRequestListResponse);

    await handleGhPr(mockHandler, {
      channelId: "test-channel",
      args: ["list", "`owner/repo`", "`5`"],
    });

    expect(listPRsSpy).toHaveBeenCalledWith("owner/repo", 5, {});

    listPRsSpy.mockRestore();
  });

  test("should preserve underscores in repo names", async () => {
    const listPRsSpy = spyOn(
      githubClient,
      "listPullRequests"
    ).mockResolvedValue(mockPullRequestListResponse);

    await handleGhPr(mockHandler, {
      channelId: "test-channel",
      args: ["list", "**my__repo__name**"],
    });

    expect(listPRsSpy).toHaveBeenCalledWith("my__repo__name", 10, {});

    listPRsSpy.mockRestore();
  });
});
