import { z } from "zod";

import { ALLOWED_EVENT_TYPES } from "../constants";

/** Supported redirect actions after OAuth completion */
export const RedirectActionSchema = z.enum([
  "subscribe",
  "subscribe-update",
  "unsubscribe-update",
  "query",
]);
export type RedirectAction = z.infer<typeof RedirectActionSchema>;

/** Event type schema for validation */
export const EventTypeSchema = z.enum(ALLOWED_EVENT_TYPES);

/** Redirect data passed through OAuth state */
export const RedirectDataSchema = z.object({
  repo: z.string(),
  eventTypes: z.array(EventTypeSchema).optional(),
  branchFilter: z.string().nullable().optional(),
  messageEventId: z.string().optional(),
});
export type RedirectData = z.infer<typeof RedirectDataSchema>;
