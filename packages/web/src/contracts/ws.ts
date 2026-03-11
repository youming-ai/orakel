import type { z } from "zod";
import type {
	BalanceSnapshotPayloadSchema,
	SignalNewPayloadSchema,
	StateSnapshotPayloadSchema,
	TradeExecutedPayloadSchema,
	WsMessageSchema,
} from "./schemas";

export type WsEventType = "state:snapshot" | "signal:new" | "trade:executed" | "balance:snapshot";

export type WsMessage = z.infer<typeof WsMessageSchema>;

export type StateSnapshotPayload = z.infer<typeof StateSnapshotPayloadSchema>;
export type SignalNewPayload = z.infer<typeof SignalNewPayloadSchema>;
export type TradeExecutedPayload = z.infer<typeof TradeExecutedPayloadSchema>;
export type BalanceSnapshotPayload = z.infer<typeof BalanceSnapshotPayloadSchema>;
