import type { z } from "zod";
import type { WsMessageSchema } from "./schemas";

export type WsEventType = "state:snapshot" | "signal:new" | "trade:executed" | "balance:snapshot";

export type WsMessage = z.infer<typeof WsMessageSchema>;
