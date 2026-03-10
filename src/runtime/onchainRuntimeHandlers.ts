import { applyEvent, updateFromSnapshot } from "../blockchain/accountState.ts";
import type { OnChainEvent } from "../blockchain/blockchainTypes.ts";
import type { BalanceSnapshotPayload } from "../contracts/stateTypes.ts";
import { emitBalanceSnapshot, setOnchainBalance } from "../core/state.ts";
import { balanceSnapshotQueries, onchainQueries } from "../db/queries.ts";

export function handleOnchainBalanceSnapshot(snapshot: BalanceSnapshotPayload): void {
	updateFromSnapshot(snapshot);
	setOnchainBalance(snapshot);
	emitBalanceSnapshot(snapshot);
	void balanceSnapshotQueries
		.insert({
			timestamp: snapshot.timestamp,
			usdcBalance: snapshot.usdcBalance,
			usdcRaw: snapshot.usdcRaw,
			blockNumber: snapshot.blockNumber,
			positions: JSON.stringify(snapshot.positions),
		})
		.catch(() => {});
}

export function toOnchainEventInsert(event: OnChainEvent) {
	return {
		txHash: event.txHash,
		logIndex: event.logIndex,
		blockNumber: event.blockNumber,
		eventType: event.type,
		fromAddr: event.from,
		toAddr: event.to,
		tokenId: event.tokenId,
		value: event.value,
		rawData: JSON.stringify(event),
	};
}

export async function handleOnchainEvent(
	event: OnChainEvent,
	logWarn: (message: string, error: unknown) => void,
): Promise<void> {
	applyEvent(event);
	try {
		await onchainQueries.insertEvent(toOnchainEventInsert(event));
	} catch (err) {
		logWarn("Failed to persist on-chain event", err);
	}
}
