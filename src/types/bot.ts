import type { Bot } from "@towns-protocol/bot";
import type commands from "../commands";

/**
 * TownsBot type alias with our specific command definitions
 */
export type TownsBot = Bot<typeof commands>;
