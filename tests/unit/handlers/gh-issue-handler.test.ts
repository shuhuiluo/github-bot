import { describe, expect, test, beforeEach, mock, spyOn } from "bun:test";
import { handleGhIssue } from "../../../src/handlers/gh-issue-handler";
import { createMockBotHandler } from "../../fixtures/mock-bot-handler";
import {
  mockIssueResponse,
  mockClosedIssueResponse,
  mockIssueWithoutLabelsResponse,
} from "../../fixtures/github-payloads";
import * as githubClient from "../../../src/api/github-client";

describe("gh_issue handler", () => {
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
      "❌ Usage: `/gh_issue owner/repo #123 [--full]` or `/gh_issue owner/repo 123 [--full]`"
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
      "❌ Usage: `/gh_issue owner/repo #123 [--full]` or `/gh_issue owner/repo 123 [--full]`"
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
