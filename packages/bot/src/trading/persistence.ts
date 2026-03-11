import { emitSignalNew } from "../core/state.ts";
import { buildSignalNewPayload, buildTradeSignalPayload, type SignalPayloadParams } from "./signalPayload.ts";
import type { TradeSignal } from "./tradeTypes.ts";

export function persistSignal(params: SignalPayloadParams): TradeSignal | null {
	const signalPayload = buildTradeSignalPayload(params);
	if (!signalPayload) return null;

	emitSignalNew(buildSignalNewPayload(params, signalPayload));
	return signalPayload;
}
