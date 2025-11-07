import { describe, expect, test, beforeEach, spyOn } from "bun:test";
import { handleGhPr } from "../../../src/handlers/gh-pr-handler";
import { createMockBotHandler } from "../../fixtures/mock-bot-handler";
import {
  mockPullRequestResponse,
  mockMergedPullRequestResponse,
  mockClosedPullRequestResponse,
} from "../../fixtures/github-payloads";
import * as githubClient from "../../../src/api/github-client";

describe("gh_pr handler", () => {
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
      "❌ Usage: `/gh_pr owner/repo #123 [--full]` or `/gh_pr owner/repo 123 [--full]`"
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
      "❌ Usage: `/gh_pr owner/repo #123 [--full]` or `/gh_pr owner/repo 123 [--full]`"
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
