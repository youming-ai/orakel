import { applyEvent, initAccountState, resetAccountState, updateFromSnapshot } from "../blockchain/accountState.ts";
import { startReconciler } from "../blockchain/reconciler.ts";
import { createLogger } from "../core/logger.ts";
import { emitBalanceSnapshot, setOnchainBalance } from "../core/state.ts";
import { startBalancePolling } from "../data/polygonBalance.ts";
import { startOnChainEventStream } from "../data/polygonEvents.ts";
import { onchainQueries } from "../db/queries.ts";
import { getWallet } from "../trading/trader.ts";

const log = createLogger("onchain-runtime");

interface OnchainRuntimeParams {
	readKnownTokenIds: () => Promise<string[]>;
}

export interface OnchainRuntime {
	ensurePipelines: () => void;
	closePipelines: () => void;
}

export function createOnchainRuntime({ readKnownTokenIds }: OnchainRuntimeParams): OnchainRuntime {
	let balancePollingHandle: { getLast(): unknown; close(): void } | null = null;
	let eventStreamHandle: { close(): void } | null = null;
	let reconcilerHandle: { runNow(): Promise<number>; close(): void } | null = null;
	let activeOnchainWallet: string | null = null;

	const closePipelines = () => {
		if (balancePollingHandle) {
			balancePollingHandle.close();
			balancePollingHandle = null;
		}
		if (eventStreamHandle) {
			eventStreamHandle.close();
			eventStreamHandle = null;
		}
		if (reconcilerHandle) {
			reconcilerHandle.close();
			reconcilerHandle = null;
		}
		activeOnchainWallet = null;
		resetAccountState();
	};

	const ensurePipelines = () => {
		const wallet = getWallet();
		if (!wallet) {
			if (activeOnchainWallet !== null) {
				log.info("Wallet disconnected, stopping on-chain pipelines");
				closePipelines();
			}
			return;
		}

		const walletAddress = wallet.address.toLowerCase();
		const walletChanged = activeOnchainWallet !== null && activeOnchainWallet !== walletAddress;
		if (walletChanged) {
			log.info(`Wallet changed (${activeOnchainWallet} -> ${walletAddress}), restarting on-chain pipelines`);
			closePipelines();
		}

		if (activeOnchainWallet === walletAddress && balancePollingHandle && eventStreamHandle && reconcilerHandle) {
			return;
		}

		initAccountState(walletAddress);
		balancePollingHandle = startBalancePolling({
			wallet: walletAddress,
			knownTokenIds: readKnownTokenIds,
			onUpdate: (snapshot) => {
				updateFromSnapshot(snapshot);
				setOnchainBalance(snapshot);
				emitBalanceSnapshot(snapshot);
			},
		});
		eventStreamHandle = startOnChainEventStream({
			wallet: walletAddress,
			onEvent: (event) => {
				applyEvent(event);
				void onchainQueries
					.insertEvent({
						txHash: event.txHash,
						logIndex: event.logIndex,
						blockNumber: event.blockNumber,
						eventType: event.type,
						fromAddr: event.from,
						toAddr: event.to,
						tokenId: event.tokenId,
						value: event.value,
						rawData: JSON.stringify(event),
					})
					.catch((err) => {
						log.warn("Failed to persist on-chain event", err);
					});
			},
		});
		reconcilerHandle = startReconciler({ wallet: walletAddress });
		activeOnchainWallet = walletAddress;
		log.info("On-chain balance/events/reconciler pipelines started");
	};

	return {
		ensurePipelines,
		closePipelines,
	};
}
