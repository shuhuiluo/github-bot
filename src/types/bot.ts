import type { Bot, BotEvents } from "@towns-protocol/bot";

import type commands from "../commands";

/**
 * TownsBot type alias with our specific command definitions
 */
export type TownsBot = Bot<typeof commands>;

/**
 * Slash command event type inferred from SDK
 */
export type SlashCommandEvent = Parameters<
  BotEvents<typeof commands>["slashCommand"]
>[1];
