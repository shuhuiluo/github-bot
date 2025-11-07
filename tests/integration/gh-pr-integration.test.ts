import { describe, expect, test } from "bun:test";
import { handleGhPr } from "../../src/handlers/gh-pr-handler";
import { createMockBotHandler } from "../fixtures/mock-bot-handler";

/**
 * Integration test for gh_pr handler
 * This test makes REAL API calls to GitHub to verify actual behavior
 */
describe("gh_pr handler - Integration", () => {
  test("should fetch real GitHub PR from towns-protocol/towns #4034", async () => {
    const mockHandler = createMockBotHandler();

    await handleGhPr(mockHandler, {
      channelId: "test-channel",
      args: ["towns-protocol/towns", "#4034"],
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

    // Should contain the actual PR data
    expect(message).toContain("**Pull Request #4034**");
    expect(message).toContain("**towns-protocol/towns**");

    // Should contain the description (truncated to 100 chars)
    expect(message).toContain("no need for this to be in two places");

    // Should have formatted fields
    expect(message).toContain("📊 Status:");
    expect(message).toContain("👤 Author:");
    expect(message).toContain("💬 Comments:");
    expect(message).toContain("📝 Changes:");
    expect(message).toContain("🔗 https://github.com/towns-protocol/towns");

    // Log the actual message for inspection
    console.log("\n📋 Actual PR message sent:");
    console.log(message);
  }, 10000); // 10 second timeout for API call

  test("should handle non-existent PR gracefully", async () => {
    const mockHandler = createMockBotHandler();

    await handleGhPr(mockHandler, {
      channelId: "test-channel",
      args: ["towns-protocol/towns", "#999999"],
    });

    expect(mockHandler.sendMessage).toHaveBeenCalledTimes(1);

    const [, message] = mockHandler.sendMessage.mock.calls[0];

    // Should get a proper error message
    expect(message).toContain("❌ Error:");
    expect(message).toContain("404");

    console.log("\n❌ Error message for non-existent PR:");
    console.log(message);
  }, 10000);

  test("should handle invalid repository gracefully", async () => {
    const mockHandler = createMockBotHandler();

    await handleGhPr(mockHandler, {
      channelId: "test-channel",
      args: ["this-repo/does-not-exist-12345", "#1"],
    });

    expect(mockHandler.sendMessage).toHaveBeenCalledTimes(1);

    const [, message] = mockHandler.sendMessage.mock.calls[0];

    // Should get a proper error message
    expect(message).toContain("❌ Error:");

    console.log("\n❌ Error message for invalid repo:");
    console.log(message);
  }, 10000);
});
