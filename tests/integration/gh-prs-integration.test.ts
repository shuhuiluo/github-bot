import { describe, expect, test } from "bun:test";
import { handleGhPrs } from "../../src/handlers/gh-prs-handler";
import { createMockBotHandler } from "../fixtures/mock-bot-handler";

/**
 * Integration test for gh_prs handler
 * This test makes REAL API calls to GitHub to verify actual behavior
 */
describe("gh_prs handler - Integration", () => {
  test("should fetch real GitHub PRs from facebook/react", async () => {
    const mockHandler = createMockBotHandler();

    await handleGhPrs(mockHandler, {
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
    expect(message).toContain("**Recent Pull Requests - facebook/react**");
    expect(message).toContain("Showing");
    expect(message).toContain("most recent PRs:");

    // Should have hyperlinked PR numbers [#xxx](url)
    expect(message).toMatch(
      /\[#\d+\]\(https:\/\/github\.com\/facebook\/react\/pull\/\d+\)/
    );

    // Should have status indicators
    expect(message).toMatch(/🟢 Open|✅ Merged|❌ Closed/);

    // Should have "by" author
    expect(message).toContain("by");

    // Log the actual message for inspection
    console.log("\n📋 Actual PRs message sent:");
    console.log(message);
  }, 15000); // 15 second timeout for API call

  test("should handle custom count parameter", async () => {
    const mockHandler = createMockBotHandler();

    await handleGhPrs(mockHandler, {
      channelId: "test-channel",
      args: ["facebook/react", "3"],
    });

    expect(mockHandler.sendMessage).toHaveBeenCalledTimes(1);

    const [, message] = mockHandler.sendMessage.mock.calls[0];

    // Should show correct count (approximately, as it might show "Showing N most recent PRs")
    expect(message).toContain("Showing 3 most recent PRs:");

    console.log("\n📋 PRs with count=3:");
    console.log(message);
  }, 15000);

  test("should handle non-existent repository gracefully", async () => {
    const mockHandler = createMockBotHandler();

    await handleGhPrs(mockHandler, {
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

  test("should handle repository with no PRs gracefully", async () => {
    const mockHandler = createMockBotHandler();

    // Using a very small repo that likely has no PRs
    // Note: This might fail if the repo gains PRs in the future
    await handleGhPrs(mockHandler, {
      channelId: "test-channel",
      args: ["github/gitignore"],
    });

    expect(mockHandler.sendMessage).toHaveBeenCalledTimes(1);

    const [, message] = mockHandler.sendMessage.mock.calls[0];

    // Should either show PRs or say no PRs found
    if (message.includes("No pull requests found")) {
      expect(message).toContain(
        "No pull requests found for **github/gitignore**"
      );
    } else {
      // Or it might have some PRs
      expect(message).toContain("**Recent Pull Requests - github/gitignore**");
    }

    console.log("\n📋 Message for repo with few/no PRs:");
    console.log(message);
  }, 15000);

  test("should show correct PR statuses (open/merged/closed)", async () => {
    const mockHandler = createMockBotHandler();

    // facebook/react is a large repo with all types of PRs
    await handleGhPrs(mockHandler, {
      channelId: "test-channel",
      args: ["facebook/react", "20"],
    });

    expect(mockHandler.sendMessage).toHaveBeenCalledTimes(1);

    const [, message] = mockHandler.sendMessage.mock.calls[0];

    // Should have at least one status indicator
    const hasOpen = message.includes("🟢 Open");
    const hasMerged = message.includes("✅ Merged");
    const hasClosed = message.includes("❌ Closed");

    expect(hasOpen || hasMerged || hasClosed).toBe(true);

    console.log("\n📊 PR statuses present:");
    console.log(`Open: ${hasOpen}, Merged: ${hasMerged}, Closed: ${hasClosed}`);
  }, 15000);
});
