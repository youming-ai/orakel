import type {
	BalanceSnapshotPayload,
	SignalNewPayload,
	StateSnapshotPayload,
	TradeExecutedPayload,
	WsEventType,
	WsMessage,
} from "./stateTypes.ts";

export type BotEventType = WsEventType;
export type BotWsMessage<T = unknown> = WsMessage<T>;

export type StateSnapshotDto = StateSnapshotPayload;
export type SignalNewDto = SignalNewPayload;
export type TradeExecutedDto = TradeExecutedPayload;
export type BalanceSnapshotDto = BalanceSnapshotPayload;
