import { beforeEach, describe, expect, spyOn, test } from "bun:test";

import * as githubClient from "../../../src/api/github-client";
import { dbService } from "../../../src/db";
import { handleGithubSubscription } from "../../../src/handlers/github-subscription-handler";
import { createMockBotHandler } from "../../fixtures/mock-bot-handler";

describe("github subscription handler", () => {
  let mockHandler: ReturnType<typeof createMockBotHandler>;

  beforeEach(() => {
    mockHandler = createMockBotHandler();
    mockHandler.sendMessage.mockClear();
  });

  describe("general", () => {
    test("should send usage message when no action provided", async () => {
      await handleGithubSubscription(mockHandler, {
        channelId: "test-channel",
        args: [],
      });

      expect(mockHandler.sendMessage).toHaveBeenCalledTimes(1);
      expect(mockHandler.sendMessage).toHaveBeenCalledWith(
        "test-channel",
        "**Usage:**\n" +
          "• `/github subscribe owner/repo [--events pr,issues,commits,releases,ci,comments,reviews,branches,review_comments,stars,forks,all]` - Subscribe to GitHub events\n" +
          "• `/github unsubscribe owner/repo` - Unsubscribe from a repository\n" +
          "• `/github status` - Show current subscriptions"
      );
    });

    test("should send error for unknown action", async () => {
      await handleGithubSubscription(mockHandler, {
        channelId: "test-channel",
        args: ["unknown"],
      });

      expect(mockHandler.sendMessage).toHaveBeenCalledTimes(1);
      const message = mockHandler.sendMessage.mock.calls[0][1];
      expect(message).toContain("❌ Unknown action: `unknown`");
      expect(message).toContain("**Available actions:**");
      expect(message).toContain("• `subscribe`");
      expect(message).toContain("• `unsubscribe`");
      expect(message).toContain("• `status`");
    });

    test("should handle case-insensitive actions - subscribe", async () => {
      const validateRepoSpy = spyOn(
        githubClient,
        "validateRepo"
      ).mockResolvedValue(true);
      const isSubscribedSpy = spyOn(
        dbService,
        "isSubscribed"
      ).mockResolvedValue(false);
      const subscribeSpy = spyOn(dbService, "subscribe").mockResolvedValue();

      await handleGithubSubscription(mockHandler, {
        channelId: "test-channel",
        args: ["SUBSCRIBE", "owner/repo"],
      });

      expect(validateRepoSpy).toHaveBeenCalledWith("owner/repo");
      expect(mockHandler.sendMessage).toHaveBeenCalledTimes(1);
      const message = mockHandler.sendMessage.mock.calls[0][1];
      expect(message).toContain("✅ **Subscribed to owner/repo**");

      validateRepoSpy.mockRestore();
      isSubscribedSpy.mockRestore();
      subscribeSpy.mockRestore();
    });

    test("should handle case-insensitive actions - unsubscribe", async () => {
      const getChannelSubscriptionsSpy = spyOn(
        dbService,
        "getChannelSubscriptions"
      ).mockResolvedValue([
        { repo: "owner/repo", eventTypes: "pr,issues,commits,releases" },
      ]);
      const unsubscribeSpy = spyOn(dbService, "unsubscribe").mockResolvedValue(
        true
      );

      await handleGithubSubscription(mockHandler, {
        channelId: "test-channel",
        args: ["UNSUBSCRIBE", "owner/repo"],
      });

      expect(mockHandler.sendMessage).toHaveBeenCalledWith(
        "test-channel",
        "✅ **Unsubscribed from owner/repo**"
      );

      getChannelSubscriptionsSpy.mockRestore();
      unsubscribeSpy.mockRestore();
    });

    test("should handle case-insensitive actions - status", async () => {
      const getChannelSubscriptionsSpy = spyOn(
        dbService,
        "getChannelSubscriptions"
      ).mockResolvedValue([
        { repo: "owner/repo", eventTypes: "pr,issues,commits,releases" },
      ]);

      await handleGithubSubscription(mockHandler, {
        channelId: "test-channel",
        args: ["STATUS"],
      });

      const message = mockHandler.sendMessage.mock.calls[0][1];
      expect(message).toContain("📬 **Subscribed Repositories (1):**");
      expect(message).toContain("• owner/repo");

      getChannelSubscriptionsSpy.mockRestore();
    });
  });

  describe("subscribe action", () => {
    test("should send error for missing repo argument", async () => {
      await handleGithubSubscription(mockHandler, {
        channelId: "test-channel",
        args: ["subscribe"],
      });

      expect(mockHandler.sendMessage).toHaveBeenCalledTimes(1);
      expect(mockHandler.sendMessage).toHaveBeenCalledWith(
        "test-channel",
        "❌ Usage: `/github subscribe owner/repo [--events pr,issues,commits,releases,ci,comments,reviews,branches,review_comments,stars,forks,all]`"
      );
    });

    test("should send error for invalid repo format (no slash)", async () => {
      await handleGithubSubscription(mockHandler, {
        channelId: "test-channel",
        args: ["subscribe", "invalidrepo"],
      });

      expect(mockHandler.sendMessage).toHaveBeenCalledTimes(1);
      expect(mockHandler.sendMessage).toHaveBeenCalledWith(
        "test-channel",
        "❌ Invalid format. Use: `owner/repo` (e.g., `facebook/react`)"
      );
    });

    test("should send error for invalid repo format (multiple slashes)", async () => {
      await handleGithubSubscription(mockHandler, {
        channelId: "test-channel",
        args: ["subscribe", "owner/repo/extra"],
      });

      expect(mockHandler.sendMessage).toHaveBeenCalledTimes(1);
      expect(mockHandler.sendMessage).toHaveBeenCalledWith(
        "test-channel",
        "❌ Invalid format. Use: `owner/repo` (e.g., `facebook/react`)"
      );
    });

    test("should send error when repo doesn't exist (validateRepo fails)", async () => {
      const validateRepoSpy = spyOn(
        githubClient,
        "validateRepo"
      ).mockResolvedValue(false);
      const isSubscribedSpy = spyOn(
        dbService,
        "isSubscribed"
      ).mockResolvedValue(false);

      await handleGithubSubscription(mockHandler, {
        channelId: "test-channel",
        args: ["subscribe", "owner/nonexistent"],
      });

      expect(validateRepoSpy).toHaveBeenCalledWith("owner/nonexistent");
      expect(mockHandler.sendMessage).toHaveBeenCalledWith(
        "test-channel",
        "❌ Repository **owner/nonexistent** not found or is not public"
      );

      validateRepoSpy.mockRestore();
      isSubscribedSpy.mockRestore();
    });

    test("should successfully subscribe to valid repo with default event types", async () => {
      const validateRepoSpy = spyOn(
        githubClient,
        "validateRepo"
      ).mockResolvedValue(true);
      const isSubscribedSpy = spyOn(
        dbService,
        "isSubscribed"
      ).mockResolvedValue(false);
      const subscribeSpy = spyOn(dbService, "subscribe").mockResolvedValue();

      await handleGithubSubscription(mockHandler, {
        channelId: "test-channel",
        args: ["subscribe", "facebook/react"],
      });

      expect(validateRepoSpy).toHaveBeenCalledWith("facebook/react");
      expect(subscribeSpy).toHaveBeenCalledWith(
        "test-channel",
        "facebook/react",
        "pr,issues,commits,releases"
      );
      expect(mockHandler.sendMessage).toHaveBeenCalledTimes(1);

      const message = mockHandler.sendMessage.mock.calls[0][1];
      expect(message).toContain("✅ **Subscribed to facebook/react**");
      expect(message).toContain("pr, issues, commits, releases");

      validateRepoSpy.mockRestore();
      isSubscribedSpy.mockRestore();
      subscribeSpy.mockRestore();
    });

    test("should handle custom event types with --events flag", async () => {
      const validateRepoSpy = spyOn(
        githubClient,
        "validateRepo"
      ).mockResolvedValue(true);
      const isSubscribedSpy = spyOn(
        dbService,
        "isSubscribed"
      ).mockResolvedValue(false);
      const subscribeSpy = spyOn(dbService, "subscribe").mockResolvedValue();

      await handleGithubSubscription(mockHandler, {
        channelId: "test-channel",
        args: ["subscribe", "owner/repo", "--events", "pr,ci"],
      });

      expect(subscribeSpy).toHaveBeenCalledWith(
        "test-channel",
        "owner/repo",
        "pr,ci"
      );

      const message = mockHandler.sendMessage.mock.calls[0][1];
      expect(message).toContain("pr, ci");

      validateRepoSpy.mockRestore();
      isSubscribedSpy.mockRestore();
      subscribeSpy.mockRestore();
    });

    test("should handle --events=all flag", async () => {
      const validateRepoSpy = spyOn(
        githubClient,
        "validateRepo"
      ).mockResolvedValue(true);
      const isSubscribedSpy = spyOn(
        dbService,
        "isSubscribed"
      ).mockResolvedValue(false);
      const subscribeSpy = spyOn(dbService, "subscribe").mockResolvedValue();

      await handleGithubSubscription(mockHandler, {
        channelId: "test-channel",
        args: ["subscribe", "owner/repo", "--events=all"],
      });

      expect(subscribeSpy).toHaveBeenCalledWith(
        "test-channel",
        "owner/repo",
        "pr,issues,commits,releases,ci,comments,reviews,branches,review_comments,stars,forks"
      );

      validateRepoSpy.mockRestore();
      isSubscribedSpy.mockRestore();
      subscribeSpy.mockRestore();
    });

    test("should reject invalid event types", async () => {
      await handleGithubSubscription(mockHandler, {
        channelId: "test-channel",
        args: ["subscribe", "owner/repo", "--events", "pr,invalid"],
      });

      const message = mockHandler.sendMessage.mock.calls[0][1];
      expect(message).toContain("❌ Invalid event type(s): 'invalid'");
    });

    test("should send info message when already subscribed", async () => {
      const isSubscribedSpy = spyOn(
        dbService,
        "isSubscribed"
      ).mockResolvedValue(true);

      await handleGithubSubscription(mockHandler, {
        channelId: "test-channel",
        args: ["subscribe", "owner/repo"],
      });

      expect(mockHandler.sendMessage).toHaveBeenCalledWith(
        "test-channel",
        "ℹ️ Already subscribed to **owner/repo**"
      );

      isSubscribedSpy.mockRestore();
    });

    test("should strip markdown from repo name", async () => {
      const validateRepoSpy = spyOn(
        githubClient,
        "validateRepo"
      ).mockResolvedValue(true);
      const isSubscribedSpy = spyOn(
        dbService,
        "isSubscribed"
      ).mockResolvedValue(false);
      const subscribeSpy = spyOn(dbService, "subscribe").mockResolvedValue();

      await handleGithubSubscription(mockHandler, {
        channelId: "test-channel",
        args: ["subscribe", "**owner/repo**"],
      });

      // Should call validateRepo with stripped name
      expect(validateRepoSpy).toHaveBeenCalledWith("owner/repo");
      expect(subscribeSpy).toHaveBeenCalledWith(
        "test-channel",
        "owner/repo",
        "pr,issues,commits,releases"
      );

      validateRepoSpy.mockRestore();
      isSubscribedSpy.mockRestore();
      subscribeSpy.mockRestore();
    });

    test("should strip various markdown formats from repo name", async () => {
      const validateRepoSpy = spyOn(
        githubClient,
        "validateRepo"
      ).mockResolvedValue(true);
      const isSubscribedSpy = spyOn(
        dbService,
        "isSubscribed"
      ).mockResolvedValue(false);
      const subscribeSpy = spyOn(dbService, "subscribe").mockResolvedValue();

      await handleGithubSubscription(mockHandler, {
        channelId: "test-channel",
        args: ["subscribe", "`owner/repo`"],
      });

      expect(validateRepoSpy).toHaveBeenCalledWith("owner/repo");

      validateRepoSpy.mockRestore();
      isSubscribedSpy.mockRestore();
      subscribeSpy.mockRestore();
    });
  });

  describe("unsubscribe action", () => {
    test("should send error for missing repo argument", async () => {
      await handleGithubSubscription(mockHandler, {
        channelId: "test-channel",
        args: ["unsubscribe"],
      });

      expect(mockHandler.sendMessage).toHaveBeenCalledWith(
        "test-channel",
        "❌ Usage: `/github unsubscribe owner/repo`"
      );
    });

    test("should send error for invalid repo format (no slash)", async () => {
      await handleGithubSubscription(mockHandler, {
        channelId: "test-channel",
        args: ["unsubscribe", "invalidrepo"],
      });

      expect(mockHandler.sendMessage).toHaveBeenCalledWith(
        "test-channel",
        "❌ Invalid format. Use: `owner/repo` (e.g., `facebook/react`)"
      );
    });

    test("should send error for invalid repo format (multiple slashes)", async () => {
      await handleGithubSubscription(mockHandler, {
        channelId: "test-channel",
        args: ["unsubscribe", "owner/repo/extra"],
      });

      expect(mockHandler.sendMessage).toHaveBeenCalledWith(
        "test-channel",
        "❌ Invalid format. Use: `owner/repo` (e.g., `facebook/react`)"
      );
    });

    test("should send error when channel has no subscriptions", async () => {
      const getChannelSubscriptionsSpy = spyOn(
        dbService,
        "getChannelSubscriptions"
      ).mockResolvedValue([]);

      await handleGithubSubscription(mockHandler, {
        channelId: "test-channel",
        args: ["unsubscribe", "owner/repo"],
      });

      expect(mockHandler.sendMessage).toHaveBeenCalledWith(
        "test-channel",
        "❌ This channel has no subscriptions"
      );

      getChannelSubscriptionsSpy.mockRestore();
    });

    test("should send error when not subscribed to specified repo", async () => {
      const getChannelSubscriptionsSpy = spyOn(
        dbService,
        "getChannelSubscriptions"
      ).mockResolvedValue([
        { repo: "owner/other", eventTypes: "pr,issues,commits,releases" },
      ]);

      await handleGithubSubscription(mockHandler, {
        channelId: "test-channel",
        args: ["unsubscribe", "owner/repo"],
      });

      const message = mockHandler.sendMessage.mock.calls[0][1];
      expect(message).toContain("❌ Not subscribed to **owner/repo**");
      expect(message).toContain(
        "Use `/github status` to see your subscriptions"
      );

      getChannelSubscriptionsSpy.mockRestore();
    });

    test("should successfully unsubscribe from specific repo", async () => {
      const getChannelSubscriptionsSpy = spyOn(
        dbService,
        "getChannelSubscriptions"
      ).mockResolvedValue([
        { repo: "owner/repo", eventTypes: "pr,issues,commits,releases" },
      ]);
      const unsubscribeSpy = spyOn(dbService, "unsubscribe").mockResolvedValue(
        true
      );

      await handleGithubSubscription(mockHandler, {
        channelId: "test-channel",
        args: ["unsubscribe", "owner/repo"],
      });

      expect(mockHandler.sendMessage).toHaveBeenCalledWith(
        "test-channel",
        "✅ **Unsubscribed from owner/repo**"
      );

      getChannelSubscriptionsSpy.mockRestore();
      unsubscribeSpy.mockRestore();
    });

    test("should strip markdown from repo name", async () => {
      const getChannelSubscriptionsSpy = spyOn(
        dbService,
        "getChannelSubscriptions"
      ).mockResolvedValue([
        { repo: "owner/repo", eventTypes: "pr,issues,commits,releases" },
      ]);
      const unsubscribeSpy = spyOn(dbService, "unsubscribe").mockResolvedValue(
        true
      );

      await handleGithubSubscription(mockHandler, {
        channelId: "test-channel",
        args: ["unsubscribe", "**owner/repo**"],
      });

      expect(mockHandler.sendMessage).toHaveBeenCalledWith(
        "test-channel",
        "✅ **Unsubscribed from owner/repo**"
      );

      getChannelSubscriptionsSpy.mockRestore();
      unsubscribeSpy.mockRestore();
    });
  });

  describe("status action", () => {
    test("should show 'No subscriptions' when channel has no repos", async () => {
      const getChannelSubscriptionsSpy = spyOn(
        dbService,
        "getChannelSubscriptions"
      ).mockResolvedValue([]);

      await handleGithubSubscription(mockHandler, {
        channelId: "test-channel",
        args: ["status"],
      });

      expect(mockHandler.sendMessage).toHaveBeenCalledWith(
        "test-channel",
        "📭 **No subscriptions**\n\nUse `/github subscribe owner/repo` to get started"
      );

      getChannelSubscriptionsSpy.mockRestore();
    });

    test("should list all subscribed repos", async () => {
      const getChannelSubscriptionsSpy = spyOn(
        dbService,
        "getChannelSubscriptions"
      ).mockResolvedValue([
        { repo: "facebook/react", eventTypes: "pr,issues,commits,releases" },
      ]);

      await handleGithubSubscription(mockHandler, {
        channelId: "test-channel",
        args: ["status"],
      });

      const message = mockHandler.sendMessage.mock.calls[0][1];
      expect(message).toContain("📬 **Subscribed Repositories (1):**");
      expect(message).toContain("• facebook/react");

      getChannelSubscriptionsSpy.mockRestore();
    });

    test("should format multiple repos correctly", async () => {
      const getChannelSubscriptionsSpy = spyOn(
        dbService,
        "getChannelSubscriptions"
      ).mockResolvedValue([
        { repo: "facebook/react", eventTypes: "pr,issues,commits,releases" },
        { repo: "microsoft/vscode", eventTypes: "pr,ci" },
        { repo: "vercel/next.js", eventTypes: "all" },
      ]);

      await handleGithubSubscription(mockHandler, {
        channelId: "test-channel",
        args: ["status"],
      });

      const message = mockHandler.sendMessage.mock.calls[0][1];
      expect(message).toContain("📬 **Subscribed Repositories (3):**");
      expect(message).toContain(
        "• facebook/react (pr, issues, commits, releases)"
      );
      expect(message).toContain("• microsoft/vscode (pr, ci)");
      expect(message).toContain("• vercel/next.js (all)");

      getChannelSubscriptionsSpy.mockRestore();
    });
  });
});
