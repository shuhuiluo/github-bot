import { beforeEach, describe, expect, mock, test } from "bun:test";

import {
  ALLOWED_EVENT_TYPES,
  DEFAULT_EVENT_TYPES,
  type EventType,
} from "../../../src/constants";
import { handleGithubSubscription } from "../../../src/handlers/github-subscription-handler";
import { TokenStatus } from "../../../src/services/github-oauth-service";
import { createMockBotHandler } from "../../fixtures/mock-bot-handler";

// Helper to create test events
function createTestEvent(overrides: any = {}) {
  return {
    channelId: "test-channel",
    spaceId: "test-space",
    userId: "0x123",
    eventId: "test-event",
    createdAt: new Date(),
    mentions: [],
    replyId: undefined,
    threadId: undefined,
    args: [],
    ...overrides,
  };
}

describe("github subscription handler", () => {
  let mockHandler: any;
  let mockSubscriptionService: any;
  let mockOAuthService: any;

  beforeEach(() => {
    mockHandler = createMockBotHandler();

    // Mock subscription service
    mockSubscriptionService = {
      createSubscription: mock(() =>
        Promise.resolve({
          success: true,
          repoFullName: "owner/repo",
          deliveryMode: "webhook",
          installUrl: "https://github.com/apps/test",
        })
      ),
      getChannelSubscriptions: mock(() => Promise.resolve([])),
      unsubscribe: mock(() => Promise.resolve(true)),
      removeEventTypes: mock(() =>
        Promise.resolve({ success: true, deleted: true })
      ),
      updateSubscription: mock(() =>
        Promise.resolve({
          success: true,
          eventTypes: ["pr", "issues"],
          branchFilter: null,
        })
      ),
      registerPendingMessage: mock(() => {}),
      sendSubscriptionSuccess: mock(() => Promise.resolve()),
    };

    // Mock OAuth service
    mockOAuthService = {
      validateToken: mock(() => Promise.resolve(TokenStatus.Valid)),
      getAuthorizationUrl: mock(() =>
        Promise.resolve("https://github.com/login/oauth/authorize?...")
      ),
    };
  });

  describe("general", () => {
    test("should send usage message when no action provided", async () => {
      await handleGithubSubscription(
        mockHandler,
        createTestEvent({ args: [] }),
        mockSubscriptionService,
        mockOAuthService
      );

      expect(mockHandler.sendMessage).toHaveBeenCalledTimes(1);
      const calls = mockHandler.sendMessage.mock.calls;
      expect(calls[0][0]).toBe("test-channel");
      expect(calls[0][1]).toContain(`all,${ALLOWED_EVENT_TYPES.join(",")}`);
    });

    test("should send error for unknown action", async () => {
      await handleGithubSubscription(
        mockHandler,
        createTestEvent({ args: ["unknown"] }),
        mockSubscriptionService,
        mockOAuthService
      );

      expect(mockHandler.sendMessage).toHaveBeenCalledTimes(1);
      const message = mockHandler.sendMessage.mock.calls[0][1];
      expect(message).toContain("❌ Unknown action: `unknown`");
      expect(message).toContain("**Available actions:**");
      expect(message).toContain("• `subscribe`");
      expect(message).toContain("• `unsubscribe`");
      expect(message).toContain("• `status`");
    });

    test("should handle case-insensitive actions - subscribe", async () => {
      await handleGithubSubscription(
        mockHandler,
        createTestEvent({ args: ["SUBSCRIBE", "owner/repo"] }),
        mockSubscriptionService,
        mockOAuthService
      );

      expect(
        mockSubscriptionService.sendSubscriptionSuccess
      ).toHaveBeenCalled();
    });

    test("should handle case-insensitive actions - unsubscribe", async () => {
      mockSubscriptionService.getChannelSubscriptions = mock(() =>
        Promise.resolve([
          {
            repo: "owner/repo",
            eventTypes: DEFAULT_EVENT_TYPES,
            branchFilter: null,
          },
        ])
      );

      await handleGithubSubscription(
        mockHandler,
        createTestEvent({ args: ["UNSUBSCRIBE", "owner/repo"] }),
        mockSubscriptionService,
        mockOAuthService
      );

      const message = mockHandler.sendMessage.mock.calls[0][1];
      expect(message).toContain("✅ **Unsubscribed from owner/repo**");
    });

    test("should handle case-insensitive actions - status", async () => {
      mockSubscriptionService.getChannelSubscriptions = mock(() =>
        Promise.resolve([
          {
            repo: "owner/repo",
            eventTypes: DEFAULT_EVENT_TYPES.split(",") as EventType[],
            deliveryMode: "webhook",
            branchFilter: null,
          },
        ])
      );

      await handleGithubSubscription(
        mockHandler,
        createTestEvent({ args: ["STATUS"] }),
        mockSubscriptionService,
        mockOAuthService
      );

      const message = mockHandler.sendMessage.mock.calls[0][1];
      expect(message).toContain("📬 **Subscribed Repositories (1):**");
      expect(message).toContain("owner/repo");
    });
  });

  describe("subscribe action", () => {
    test("should send error for missing repo argument", async () => {
      await handleGithubSubscription(
        mockHandler,
        createTestEvent({ args: ["subscribe"] }),
        mockSubscriptionService,
        mockOAuthService
      );

      expect(mockHandler.sendMessage).toHaveBeenCalledTimes(1);
      const message = mockHandler.sendMessage.mock.calls[0][1];
      expect(message).toContain(`all,${ALLOWED_EVENT_TYPES.join(",")}`);
    });

    test("should send error for invalid repo format (no slash)", async () => {
      await handleGithubSubscription(
        mockHandler,
        createTestEvent({ args: ["subscribe", "invalidrepo"] }),
        mockSubscriptionService,
        mockOAuthService
      );

      expect(mockHandler.sendMessage).toHaveBeenCalledTimes(1);
      const message = mockHandler.sendMessage.mock.calls[0][1];
      expect(message).toContain("❌ Invalid format");
    });

    test("should send error for invalid repo format (multiple slashes)", async () => {
      await handleGithubSubscription(
        mockHandler,
        createTestEvent({ args: ["subscribe", "owner/repo/extra"] }),
        mockSubscriptionService,
        mockOAuthService
      );

      expect(mockHandler.sendMessage).toHaveBeenCalledTimes(1);
      const message = mockHandler.sendMessage.mock.calls[0][1];
      expect(message).toContain("❌ Invalid format");
    });

    test("should successfully subscribe with default event types", async () => {
      await handleGithubSubscription(
        mockHandler,
        createTestEvent({ args: ["subscribe", "facebook/react"] }),
        mockSubscriptionService,
        mockOAuthService
      );

      const createCalls = mockSubscriptionService.createSubscription.mock.calls;
      expect(createCalls.length).toBe(1);
      expect(createCalls[0][0]).toEqual({
        townsUserId: "0x123",
        spaceId: "test-space",
        channelId: "test-channel",
        repoIdentifier: "facebook/react",
        eventTypes: DEFAULT_EVENT_TYPES.split(","),
        branchFilter: null,
      });

      expect(
        mockSubscriptionService.sendSubscriptionSuccess
      ).toHaveBeenCalled();
    });

    test("should handle custom event types with --events flag", async () => {
      await handleGithubSubscription(
        mockHandler,
        createTestEvent({
          args: ["subscribe", "owner/repo", "--events", "pr,ci"],
        }),
        mockSubscriptionService,
        mockOAuthService
      );

      const createCalls = mockSubscriptionService.createSubscription.mock.calls;
      expect(createCalls[0][0].eventTypes).toEqual(["pr", "ci"]);
    });

    test("should handle --events=all flag", async () => {
      await handleGithubSubscription(
        mockHandler,
        createTestEvent({
          args: ["subscribe", "owner/repo", "--events=all"],
        }),
        mockSubscriptionService,
        mockOAuthService
      );

      const createCalls = mockSubscriptionService.createSubscription.mock.calls;
      expect(createCalls[0][0].eventTypes).toEqual([...ALLOWED_EVENT_TYPES]);
    });

    test("should reject invalid event types", async () => {
      await handleGithubSubscription(
        mockHandler,
        createTestEvent({
          args: ["subscribe", "owner/repo", "--events", "pr,invalid"],
        }),
        mockSubscriptionService,
        mockOAuthService
      );

      const message = mockHandler.sendMessage.mock.calls[0][1];
      expect(message).toContain("❌ Invalid event type(s): 'invalid'");
    });

    test("should handle token not linked error", async () => {
      mockOAuthService.validateToken = mock(() =>
        Promise.resolve(TokenStatus.NotLinked)
      );

      await handleGithubSubscription(
        mockHandler,
        createTestEvent({ args: ["subscribe", "owner/repo"] }),
        mockSubscriptionService,
        mockOAuthService
      );

      // Should call getAuthorizationUrl for OAuth flow
      expect(mockOAuthService.getAuthorizationUrl).toHaveBeenCalled();
    });

    test("should handle token expired error", async () => {
      mockOAuthService.validateToken = mock(() =>
        Promise.resolve(TokenStatus.Invalid)
      );

      await handleGithubSubscription(
        mockHandler,
        createTestEvent({ args: ["subscribe", "owner/repo"] }),
        mockSubscriptionService,
        mockOAuthService
      );

      // Should call getAuthorizationUrl for OAuth flow
      expect(mockOAuthService.getAuthorizationUrl).toHaveBeenCalled();
    });

    test("should handle token unknown error", async () => {
      mockOAuthService.validateToken = mock(() =>
        Promise.resolve(TokenStatus.Unknown)
      );

      await handleGithubSubscription(
        mockHandler,
        createTestEvent({ args: ["subscribe", "owner/repo"] }),
        mockSubscriptionService,
        mockOAuthService
      );

      const message = mockHandler.sendMessage.mock.calls[0][1];
      expect(message).toContain("⚠️ **Unable to Verify GitHub Connection**");
    });

    test("should handle installation required error", async () => {
      mockSubscriptionService.createSubscription = mock(() =>
        Promise.resolve({
          success: false,
          requiresInstallation: true,
          error: "Private repository requires GitHub App installation",
          installUrl: "https://github.com/apps/test/installations/new",
        })
      );

      await handleGithubSubscription(
        mockHandler,
        createTestEvent({ args: ["subscribe", "owner/repo"] }),
        mockSubscriptionService,
        mockOAuthService
      );

      const message = mockHandler.sendMessage.mock.calls[0][1];
      expect(message).toContain("🔒 **GitHub App Installation Required**");
    });

    test("should handle generic subscription error", async () => {
      mockSubscriptionService.createSubscription = mock(() =>
        Promise.resolve({
          success: false,
          error: "Repository not found",
        })
      );

      await handleGithubSubscription(
        mockHandler,
        createTestEvent({ args: ["subscribe", "owner/repo"] }),
        mockSubscriptionService,
        mockOAuthService
      );

      const message = mockHandler.sendMessage.mock.calls[0][1];
      expect(message).toContain("❌ Repository not found");
    });

    test("should handle polling mode delivery", async () => {
      const pollingResult = {
        success: true as const,
        repoFullName: "owner/repo",
        deliveryMode: "polling" as const,
        installUrl: "https://github.com/apps/test/installations/new",
        eventTypes: ["pr", "issues"] as const,
      };
      mockSubscriptionService.createSubscription = mock(() =>
        Promise.resolve(pollingResult)
      );

      await handleGithubSubscription(
        mockHandler,
        createTestEvent({ args: ["subscribe", "owner/repo"] }),
        mockSubscriptionService,
        mockOAuthService
      );

      // Verify sendSubscriptionSuccess is called with correct args
      expect(
        mockSubscriptionService.sendSubscriptionSuccess
      ).toHaveBeenCalledWith(
        pollingResult,
        expect.any(Array),
        null, // branchFilter
        "test-channel",
        mockHandler
      );
    });

    test("should send info message when already subscribed", async () => {
      mockSubscriptionService.createSubscription = mock(() =>
        Promise.resolve({
          success: false,
          requiresInstallation: false,
          error: "Already subscribed to owner/repo",
        })
      );

      await handleGithubSubscription(
        mockHandler,
        createTestEvent({ args: ["subscribe", "owner/repo"] }),
        mockSubscriptionService,
        mockOAuthService
      );

      const message = mockHandler.sendMessage.mock.calls[0][1];
      expect(message).toContain("Already subscribed");
    });

    test("should strip markdown from repo name", async () => {
      await handleGithubSubscription(
        mockHandler,
        createTestEvent({ args: ["subscribe", "**owner/repo**"] }),
        mockSubscriptionService,
        mockOAuthService
      );

      const createCalls = mockSubscriptionService.createSubscription.mock.calls;
      expect(createCalls.length).toBe(1);
      expect(createCalls[0][0].repoIdentifier).toBe("owner/repo");
    });

    test("should strip various markdown formats from repo name", async () => {
      await handleGithubSubscription(
        mockHandler,
        createTestEvent({ args: ["subscribe", "`owner/repo`"] }),
        mockSubscriptionService,
        mockOAuthService
      );

      const createCalls = mockSubscriptionService.createSubscription.mock.calls;
      expect(createCalls[0][0].repoIdentifier).toBe("owner/repo");
    });
  });

  describe("unsubscribe action", () => {
    test("should send error for missing repo argument", async () => {
      await handleGithubSubscription(
        mockHandler,
        createTestEvent({ args: ["unsubscribe"] }),
        mockSubscriptionService,
        mockOAuthService
      );

      const message = mockHandler.sendMessage.mock.calls[0][1];
      expect(message).toContain("❌ Usage: `/github unsubscribe");
    });

    test("should send error for invalid repo format", async () => {
      await handleGithubSubscription(
        mockHandler,
        createTestEvent({ args: ["unsubscribe", "invalidrepo"] }),
        mockSubscriptionService,
        mockOAuthService
      );

      const message = mockHandler.sendMessage.mock.calls[0][1];
      expect(message).toContain("❌ Invalid format");
    });

    test("should send error when channel has no subscriptions", async () => {
      mockSubscriptionService.getChannelSubscriptions = mock(() =>
        Promise.resolve([])
      );

      await handleGithubSubscription(
        mockHandler,
        createTestEvent({ args: ["unsubscribe", "owner/repo"] }),
        mockSubscriptionService,
        mockOAuthService
      );

      const message = mockHandler.sendMessage.mock.calls[0][1];
      expect(message).toContain("❌ This channel has no subscriptions");
    });

    test("should send error when not subscribed to repo", async () => {
      mockSubscriptionService.getChannelSubscriptions = mock(() =>
        Promise.resolve([
          {
            repo: "other/repo",
            eventTypes: DEFAULT_EVENT_TYPES,
            branchFilter: null,
          },
        ])
      );

      await handleGithubSubscription(
        mockHandler,
        createTestEvent({ args: ["unsubscribe", "owner/repo"] }),
        mockSubscriptionService,
        mockOAuthService
      );

      const message = mockHandler.sendMessage.mock.calls[0][1];
      expect(message).toContain("❌ Not subscribed to **owner/repo**");
    });

    test("should successfully unsubscribe from repo", async () => {
      mockSubscriptionService.getChannelSubscriptions = mock(() =>
        Promise.resolve([
          {
            repo: "owner/repo",
            eventTypes: ["pr", "issues"],
            branchFilter: null,
          },
        ])
      );
      mockSubscriptionService.removeEventTypes = mock(() =>
        Promise.resolve({ success: true, deleted: true })
      );

      await handleGithubSubscription(
        mockHandler,
        createTestEvent({ args: ["unsubscribe", "owner/repo"] }),
        mockSubscriptionService,
        mockOAuthService
      );

      const removeCalls = mockSubscriptionService.removeEventTypes.mock.calls;
      expect(removeCalls.length).toBe(1);
      expect(removeCalls[0]).toEqual([
        "0x123",
        "test-space",
        "test-channel",
        "owner/repo",
        ["pr", "issues"],
      ]);

      const message = mockHandler.sendMessage.mock.calls[0][1];
      expect(message).toContain("✅ **Unsubscribed from owner/repo**");
    });

    test("should handle case-insensitive repo names", async () => {
      mockSubscriptionService.getChannelSubscriptions = mock(() =>
        Promise.resolve([
          {
            repo: "owner/repo",
            eventTypes: ["pr", "issues"],
            branchFilter: null,
          },
        ])
      );
      mockSubscriptionService.removeEventTypes = mock(() =>
        Promise.resolve({ success: true, deleted: true })
      );

      await handleGithubSubscription(
        mockHandler,
        createTestEvent({ args: ["unsubscribe", "OWNER/REPO"] }),
        mockSubscriptionService,
        mockOAuthService
      );

      const removeCalls = mockSubscriptionService.removeEventTypes.mock.calls;
      expect(removeCalls[0][3]).toBe("owner/repo");
    });

    test("should handle unsubscribe failure", async () => {
      mockSubscriptionService.getChannelSubscriptions = mock(() =>
        Promise.resolve([
          {
            repo: "owner/repo",
            eventTypes: ["pr", "issues"],
            branchFilter: null,
          },
        ])
      );
      mockSubscriptionService.removeEventTypes = mock(() =>
        Promise.resolve({ success: false, error: "You don't have access" })
      );

      await handleGithubSubscription(
        mockHandler,
        createTestEvent({ args: ["unsubscribe", "owner/repo"] }),
        mockSubscriptionService,
        mockOAuthService
      );

      const message = mockHandler.sendMessage.mock.calls[0][1];
      expect(message).toContain("❌ You don't have access");
    });

    test("should strip markdown from repo name", async () => {
      mockSubscriptionService.getChannelSubscriptions = mock(() =>
        Promise.resolve([
          {
            repo: "owner/repo",
            eventTypes: ["pr", "issues"],
            branchFilter: null,
          },
        ])
      );
      mockSubscriptionService.removeEventTypes = mock(() =>
        Promise.resolve({ success: true, deleted: true })
      );

      await handleGithubSubscription(
        mockHandler,
        createTestEvent({ args: ["unsubscribe", "**owner/repo**"] }),
        mockSubscriptionService,
        mockOAuthService
      );

      const removeCalls = mockSubscriptionService.removeEventTypes.mock.calls;
      expect(removeCalls.length).toBe(1);
      expect(removeCalls[0][3]).toBe("owner/repo");
    });
  });

  describe("status action", () => {
    test("should send message when no subscriptions", async () => {
      mockSubscriptionService.getChannelSubscriptions = mock(() =>
        Promise.resolve([])
      );

      await handleGithubSubscription(
        mockHandler,
        createTestEvent({ args: ["status"] }),
        mockSubscriptionService,
        mockOAuthService
      );

      const message = mockHandler.sendMessage.mock.calls[0][1];
      expect(message).toContain("📭 **No subscriptions**");
    });

    test("should list all subscriptions with branch filter info", async () => {
      mockSubscriptionService.getChannelSubscriptions = mock(() =>
        Promise.resolve([
          {
            repo: "owner/repo1",
            eventTypes: DEFAULT_EVENT_TYPES.split(",") as EventType[],
            deliveryMode: "webhook",
            branchFilter: null,
          },
          {
            repo: "owner/repo2",
            eventTypes: ["pr", "ci"] as EventType[],
            deliveryMode: "polling",
            branchFilter: "main,develop",
          },
          {
            repo: "owner/repo3",
            eventTypes: ["commits"] as EventType[],
            deliveryMode: "webhook",
            branchFilter: "all",
          },
        ])
      );

      await handleGithubSubscription(
        mockHandler,
        createTestEvent({ args: ["status"] }),
        mockSubscriptionService,
        mockOAuthService
      );

      const message = mockHandler.sendMessage.mock.calls[0][1];
      expect(message).toContain("📬 **Subscribed Repositories (3):**");
      expect(message).toContain("owner/repo1");
      expect(message).toContain("owner/repo2");
      expect(message).toContain("owner/repo3");
      expect(message).toContain("default branch");
      expect(message).toContain("main,develop");
      expect(message).toContain("all branches");
    });
  });

  describe("branch filter", () => {
    test("should pass null branchFilter when no --branches flag", async () => {
      await handleGithubSubscription(
        mockHandler,
        createTestEvent({ args: ["subscribe", "owner/repo"] }),
        mockSubscriptionService,
        mockOAuthService
      );

      const createCalls = mockSubscriptionService.createSubscription.mock.calls;
      expect(createCalls[0][0].branchFilter).toBe(null);
    });

    test("should handle --branches flag with specific branches", async () => {
      await handleGithubSubscription(
        mockHandler,
        createTestEvent({
          args: ["subscribe", "owner/repo", "--branches", "main,develop"],
        }),
        mockSubscriptionService,
        mockOAuthService
      );

      const createCalls = mockSubscriptionService.createSubscription.mock.calls;
      expect(createCalls[0][0].branchFilter).toBe("main,develop");
    });

    test("should handle --branches=value format", async () => {
      await handleGithubSubscription(
        mockHandler,
        createTestEvent({
          args: ["subscribe", "owner/repo", "--branches=release/*"],
        }),
        mockSubscriptionService,
        mockOAuthService
      );

      const createCalls = mockSubscriptionService.createSubscription.mock.calls;
      expect(createCalls[0][0].branchFilter).toBe("release/*");
    });

    test("should normalize --branches=all to 'all'", async () => {
      await handleGithubSubscription(
        mockHandler,
        createTestEvent({
          args: ["subscribe", "owner/repo", "--branches", "all"],
        }),
        mockSubscriptionService,
        mockOAuthService
      );

      const createCalls = mockSubscriptionService.createSubscription.mock.calls;
      expect(createCalls[0][0].branchFilter).toBe("all");
    });

    test("should normalize --branches=* to 'all'", async () => {
      await handleGithubSubscription(
        mockHandler,
        createTestEvent({
          args: ["subscribe", "owner/repo", "--branches=*"],
        }),
        mockSubscriptionService,
        mockOAuthService
      );

      const createCalls = mockSubscriptionService.createSubscription.mock.calls;
      expect(createCalls[0][0].branchFilter).toBe("all");
    });

    test("should combine --events and --branches flags", async () => {
      await handleGithubSubscription(
        mockHandler,
        createTestEvent({
          args: [
            "subscribe",
            "owner/repo",
            "--events",
            "commits,ci",
            "--branches",
            "main",
          ],
        }),
        mockSubscriptionService,
        mockOAuthService
      );

      const createCalls = mockSubscriptionService.createSubscription.mock.calls;
      expect(createCalls[0][0].eventTypes).toEqual(["commits", "ci"]);
      expect(createCalls[0][0].branchFilter).toBe("main");
    });

    test("should trigger update when --branches flag used on existing subscription", async () => {
      mockSubscriptionService.getChannelSubscriptions = mock(() =>
        Promise.resolve([
          {
            repo: "owner/repo",
            eventTypes: ["pr", "issues"] as EventType[],
            deliveryMode: "webhook",
            branchFilter: null,
          },
        ])
      );
      mockSubscriptionService.updateSubscription = mock(() =>
        Promise.resolve({
          success: true,
          eventTypes: ["pr", "issues"],
          branchFilter: "main,develop",
        })
      );

      await handleGithubSubscription(
        mockHandler,
        createTestEvent({
          args: ["subscribe", "owner/repo", "--branches", "main,develop"],
        }),
        mockSubscriptionService,
        mockOAuthService
      );

      const updateCalls = mockSubscriptionService.updateSubscription.mock.calls;
      expect(updateCalls.length).toBe(1);
      expect(updateCalls[0][5]).toBe("main,develop");
    });
  });
});
