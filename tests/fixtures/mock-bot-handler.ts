import { mock } from "bun:test";
import type { BotHandler } from "@towns-protocol/bot";

export function createMockBotHandler(): BotHandler {
  const sendMessage = mock(() => Promise.resolve({ eventId: "test-event-id" }));
  const editMessage = mock(() => Promise.resolve(undefined));
  const sendReaction = mock(() => Promise.resolve(undefined));
  const removeEvent = mock(() => Promise.resolve(undefined));
  const adminRemoveEvent = mock(() => Promise.resolve(undefined));
  const hasAdminPermission = mock(() => Promise.resolve(false));
  const checkPermission = mock(() => Promise.resolve(true));
  const ban = mock(() => Promise.resolve(undefined));
  const unban = mock(() => Promise.resolve(undefined));

  return {
    sendMessage,
    editMessage,
    sendReaction,
    removeEvent,
    adminRemoveEvent,
    hasAdminPermission,
    checkPermission,
    ban,
    unban,
  } as any;
}
