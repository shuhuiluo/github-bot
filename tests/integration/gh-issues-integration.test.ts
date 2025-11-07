import { describe, expect, test } from "bun:test";
import { handleGhIssues } from "../../src/handlers/gh-issues-handler";
import { createMockBotHandler } from "../fixtures/mock-bot-handler";

/**
 * Integration test for gh_issues handler
 * This test makes REAL API calls to GitHub to verify actual behavior
 */
describe("gh_issues handler - Integration", () => {
  test("should fetch real GitHub issues from facebook/react", async () => {
    const mockHandler = createMockBotHandler();

    await handleGhIssues(mockHandler, {
      channelId: "test-channel",
      args: ["facebook/react", "5"],
    });

    // Should have sent exactly one message
    expect(mockHandler.sendMessage).toHaveBeenCalledTimes(1);

    const [channelId, message] = mockHandler.sendMessage.mock.calls[0];

    // Verify it's sending to the right channel
    expect(channelId).toBe("test-channel");

    // If we got an error message, log it for debugging
    if (message.startsWith("❌ Error:")) {
      console.error("GitHub API Error:", message);
      console.error("GITHUB_TOKEN set:", !!process.env.GITHUB_TOKEN);
      console.error(
        "GITHUB_TOKEN length:",
        process.env.GITHUB_TOKEN?.length || 0
      );
    }

    // Should contain the header
    expect(message).toContain("**Recent Issues - facebook/react**");
    expect(message).toContain("Showing");
    expect(message).toContain("most recent issues:");

    // Should have hyperlinked issue numbers [#xxx](url)
    expect(message).toMatch(
      /\[#\d+\]\(https:\/\/github\.com\/facebook\/react\/issues\/\d+\)/
    );

    // Should have status indicators
    expect(message).toMatch(/🟢 Open|✅ Closed/);

    // Should have "by" author
    expect(message).toContain("by");

    // Log the actual message for inspection
    console.log("\n📋 Actual issues message sent:");
    console.log(message);
  }, 15000); // 15 second timeout for API call

  test("should handle custom count parameter", async () => {
    const mockHandler = createMockBotHandler();

    await handleGhIssues(mockHandler, {
      channelId: "test-channel",
      args: ["facebook/react", "3"],
    });

    expect(mockHandler.sendMessage).toHaveBeenCalledTimes(1);

    const [, message] = mockHandler.sendMessage.mock.calls[0];

    // Should show correct count
    expect(message).toContain("Showing");
    expect(message).toContain("most recent issues:");

    console.log("\n📋 Issues with count=3:");
    console.log(message);
  }, 15000);

  test("should filter out pull requests from results", async () => {
    const mockHandler = createMockBotHandler();

    await handleGhIssues(mockHandler, {
      channelId: "test-channel",
      args: ["facebook/react", "10"],
    });

    expect(mockHandler.sendMessage).toHaveBeenCalledTimes(1);

    const [, message] = mockHandler.sendMessage.mock.calls[0];

    // All URLs should be /issues/ not /pull/
    const pullMatches = message.match(/\/pull\/\d+/g);
    expect(pullMatches).toBeNull();

    // Should have /issues/ URLs
    const issueMatches = message.match(/\/issues\/\d+/g);
    if (!message.includes("No issues found")) {
      expect(issueMatches).not.toBeNull();
    }

    console.log("\n📋 Filtered issues (no PRs):");
    console.log(message);
  }, 15000);

  test("should handle non-existent repository gracefully", async () => {
    const mockHandler = createMockBotHandler();

    await handleGhIssues(mockHandler, {
      channelId: "test-channel",
      args: ["this-repo/does-not-exist-12345"],
    });

    expect(mockHandler.sendMessage).toHaveBeenCalledTimes(1);

    const [, message] = mockHandler.sendMessage.mock.calls[0];

    // Should get a proper error message
    expect(message).toContain("❌ Error:");

    console.log("\n❌ Error message for non-existent repo:");
    console.log(message);
  }, 15000);

  test("should handle repository with no issues gracefully", async () => {
    const mockHandler = createMockBotHandler();

    // Using a small repo that might not have issues
    await handleGhIssues(mockHandler, {
      channelId: "test-channel",
      args: ["github/gitignore"],
    });

    expect(mockHandler.sendMessage).toHaveBeenCalledTimes(1);

    const [, message] = mockHandler.sendMessage.mock.calls[0];

    // Should either show issues or say no issues found
    if (message.includes("No issues found")) {
      expect(message).toMatch(/No issues found for \*\*github\/gitignore\*\*/);
    } else {
      // Or it might have some issues
      expect(message).toContain("**Recent Issues - github/gitignore**");
    }

    console.log("\n📋 Message for repo with few/no issues:");
    console.log(message);
  }, 15000);

  test("should show correct issue statuses (open/closed)", async () => {
    const mockHandler = createMockBotHandler();

    // facebook/react is a large repo with both open and closed issues
    await handleGhIssues(mockHandler, {
      channelId: "test-channel",
      args: ["facebook/react", "20"],
    });

    expect(mockHandler.sendMessage).toHaveBeenCalledTimes(1);

    const [, message] = mockHandler.sendMessage.mock.calls[0];

    // Should have at least one status indicator
    const hasOpen = message.includes("🟢 Open");
    const hasClosed = message.includes("✅ Closed");

    expect(hasOpen || hasClosed).toBe(true);

    console.log("\n📊 Issue statuses present:");
    console.log(`Open: ${hasOpen}, Closed: ${hasClosed}`);
  }, 15000);

  test("should handle repos with mostly PRs (filter them out)", async () => {
    const mockHandler = createMockBotHandler();

    // Some repos might have more PRs than issues
    await handleGhIssues(mockHandler, {
      channelId: "test-channel",
      args: ["facebook/react", "5"],
    });

    expect(mockHandler.sendMessage).toHaveBeenCalledTimes(1);

    const [, message] = mockHandler.sendMessage.mock.calls[0];

    // Should either show issues or mention that only PRs were found
    if (message.includes("(only PRs available)")) {
      expect(message).toContain(
        "No issues found for **facebook/react** (only PRs available)"
      );
    } else if (!message.startsWith("❌ Error:")) {
      // If no error, should have valid issue links
      expect(message).toContain("/issues/");
      expect(message).not.toContain("/pull/");
    }

    console.log("\n📋 Issues filtered from PRs:");
    console.log(message);
  }, 15000);
});
