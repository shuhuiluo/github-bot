import { describe, expect, test, beforeEach, spyOn } from "bun:test";
import { handleGhPrs } from "../../../src/handlers/gh-prs-handler";
import { createMockBotHandler } from "../../fixtures/mock-bot-handler";
import { mockPullRequestListResponse } from "../../fixtures/github-payloads";
import * as githubClient from "../../../src/api/github-client";

describe("gh_prs handler", () => {
  let mockHandler: ReturnType<typeof createMockBotHandler>;

  beforeEach(() => {
    mockHandler = createMockBotHandler();
    mockHandler.sendMessage.mockClear();
  });

  test("should send error for missing arguments", async () => {
    await handleGhPrs(mockHandler, {
      channelId: "test-channel",
      args: [],
    });

    expect(mockHandler.sendMessage).toHaveBeenCalledTimes(1);
    expect(mockHandler.sendMessage).toHaveBeenCalledWith(
      "test-channel",
      "❌ Usage: `/gh_prs owner/repo [count]`\n\nExample: `/gh_prs facebook/react 5`"
    );
  });

  test("should use default count of 10 when not specified", async () => {
    const listPRsSpy = spyOn(
      githubClient,
      "listPullRequests"
    ).mockResolvedValue(mockPullRequestListResponse);

    await handleGhPrs(mockHandler, {
      channelId: "test-channel",
      args: ["owner/repo"],
    });

    expect(listPRsSpy).toHaveBeenCalledWith("owner/repo", 10);

    listPRsSpy.mockRestore();
  });

  test("should use custom count when specified", async () => {
    const listPRsSpy = spyOn(
      githubClient,
      "listPullRequests"
    ).mockResolvedValue(mockPullRequestListResponse);

    await handleGhPrs(mockHandler, {
      channelId: "test-channel",
      args: ["owner/repo", "5"],
    });

    expect(listPRsSpy).toHaveBeenCalledWith("owner/repo", 5);

    listPRsSpy.mockRestore();
  });

  test("should send error for invalid count (NaN)", async () => {
    await handleGhPrs(mockHandler, {
      channelId: "test-channel",
      args: ["owner/repo", "invalid"],
    });

    expect(mockHandler.sendMessage).toHaveBeenCalledWith(
      "test-channel",
      "❌ Count must be a number between 1 and 50"
    );
  });

  test("should send error for count < 1", async () => {
    await handleGhPrs(mockHandler, {
      channelId: "test-channel",
      args: ["owner/repo", "0"],
    });

    expect(mockHandler.sendMessage).toHaveBeenCalledWith(
      "test-channel",
      "❌ Count must be a number between 1 and 50"
    );
  });

  test("should send error for count > 50", async () => {
    await handleGhPrs(mockHandler, {
      channelId: "test-channel",
      args: ["owner/repo", "100"],
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

    await handleGhPrs(mockHandler, {
      channelId: "test-channel",
      args: ["owner/repo"],
    });

    expect(listPRsSpy).toHaveBeenCalledWith("owner/repo", 10);
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

    await handleGhPrs(mockHandler, {
      channelId: "test-channel",
      args: ["owner/repo"],
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

    await handleGhPrs(mockHandler, {
      channelId: "test-channel",
      args: ["owner/repo"],
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

    await handleGhPrs(mockHandler, {
      channelId: "test-channel",
      args: ["**owner/repo**", "5"],
    });

    expect(listPRsSpy).toHaveBeenCalledWith("owner/repo", 5);

    listPRsSpy.mockRestore();
  });

  test("should strip markdown code formatting from arguments", async () => {
    const listPRsSpy = spyOn(
      githubClient,
      "listPullRequests"
    ).mockResolvedValue(mockPullRequestListResponse);

    await handleGhPrs(mockHandler, {
      channelId: "test-channel",
      args: ["`owner/repo`", "`5`"],
    });

    expect(listPRsSpy).toHaveBeenCalledWith("owner/repo", 5);

    listPRsSpy.mockRestore();
  });

  test("should preserve underscores in repo names", async () => {
    const listPRsSpy = spyOn(
      githubClient,
      "listPullRequests"
    ).mockResolvedValue(mockPullRequestListResponse);

    await handleGhPrs(mockHandler, {
      channelId: "test-channel",
      args: ["**my__repo__name**"],
    });

    expect(listPRsSpy).toHaveBeenCalledWith("my__repo__name", 10);

    listPRsSpy.mockRestore();
  });
});
