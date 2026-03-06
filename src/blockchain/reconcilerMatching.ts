import type { ReconResult } from "../contracts/stateTypes.ts";
import { rawToUsdc } from "./reconciler-utils.ts";

export interface ReconTradeCandidate {
	orderId: string;
	market: string;
	side: string;
	amount: number;
	price: number;
	timestamp: string;
}

export interface ReconKnownTokenCandidate {
	tokenId: string;
	marketId: string;
	side: string;
}

export interface ReconEventCandidate {
	eventType: string;
	value: string | null;
	toAddr: string | null;
	fromAddr: string | null;
	txHash: string | null;
	blockNumber: number | null;
	createdAt: string | number | null;
}

export interface ReconMatch<TEvent extends ReconEventCandidate = ReconEventCandidate> {
	event: TEvent;
	confidence: number;
	tokenId: string;
}

interface FindBestReconMatchParams<TToken extends ReconKnownTokenCandidate, TEvent extends ReconEventCandidate> {
	trade: ReconTradeCandidate;
	matchingTokens: TToken[];
	loadEvents: (tokenId: string) => Promise<TEvent[]>;
	walletAddress: string;
	usdcDecimals: number;
	usdcTolerance: number;
	timeCloseMs: number;
	timeMaxMs: number;
}

export function buildBaseReconResult(orderId: string): ReconResult {
	return {
		orderId,
		status: "unreconciled",
		confidence: 0,
		txHash: null,
		blockNumber: null,
	};
}

export function parseCreatedAtMs(value: string | number | null): number | null {
	if (value === null) return null;
	const rawNum = Number(value);
	if (Number.isFinite(rawNum)) {
		return rawNum > 1_000_000_000_000 ? rawNum : rawNum * 1000;
	}
	const parsed = Date.parse(String(value));
	return Number.isFinite(parsed) ? parsed : null;
}

export function findMatchingTokens<TToken extends ReconKnownTokenCandidate>(
	allTokens: TToken[],
	trade: Pick<ReconTradeCandidate, "market" | "side">,
): TToken[] {
	return allTokens.filter(
		(token) => token.marketId === trade.market && token.side.toUpperCase().includes(trade.side.toUpperCase()),
	);
}

function scoreReconEvent<TEvent extends ReconEventCandidate>(params: {
	rawEvent: TEvent;
	tradeTimestamp: number;
	expectedUsdcDelta: number;
	walletAddress: string;
	usdcDecimals: number;
	usdcTolerance: number;
	timeCloseMs: number;
	timeMaxMs: number;
}): number | null {
	const {
		rawEvent,
		tradeTimestamp,
		expectedUsdcDelta,
		walletAddress,
		usdcDecimals,
		usdcTolerance,
		timeCloseMs,
		timeMaxMs,
	} = params;

	const eventTime = parseCreatedAtMs(rawEvent.createdAt);
	if (eventTime === null) return null;

	const timeDiff = Math.abs(eventTime - tradeTimestamp);
	if (timeDiff > timeMaxMs) return null;

	let confidence = 0.3;

	if (rawEvent.eventType === "usdc_transfer") {
		if (rawEvent.value === null) return null;
		const usdcValue = rawToUsdc(BigInt(rawEvent.value), usdcDecimals);
		const delta = Math.abs(usdcValue - expectedUsdcDelta);
		const tolerance = expectedUsdcDelta * usdcTolerance;
		if (delta <= tolerance) {
			confidence += 0.3;
		}
	} else if (rawEvent.eventType === "ctf_transfer_single") {
		confidence += 0.15;
	}

	if (timeDiff <= timeCloseMs) {
		confidence += 0.2;
	}

	if (walletAddress) {
		const wallet = walletAddress.toLowerCase();
		const toAddr = typeof rawEvent.toAddr === "string" ? rawEvent.toAddr.toLowerCase() : "";
		const fromAddr = typeof rawEvent.fromAddr === "string" ? rawEvent.fromAddr.toLowerCase() : "";
		const isIncoming = toAddr === wallet;
		const isOutgoing = fromAddr === wallet;
		if (isIncoming || isOutgoing) {
			confidence += 0.15;
		}
	}

	return confidence;
}

export async function findBestReconMatch<TToken extends ReconKnownTokenCandidate, TEvent extends ReconEventCandidate>({
	trade,
	matchingTokens,
	loadEvents,
	walletAddress,
	usdcDecimals,
	usdcTolerance,
	timeCloseMs,
	timeMaxMs,
}: FindBestReconMatchParams<TToken, TEvent>): Promise<ReconMatch<TEvent> | null> {
	const tradeTimestamp = new Date(trade.timestamp).getTime();
	if (!Number.isFinite(tradeTimestamp)) {
		return null;
	}

	const expectedUsdcDelta = Number(trade.amount) * Number(trade.price);
	let bestMatch: ReconMatch<TEvent> | null = null;

	for (const token of matchingTokens) {
		const events = await loadEvents(token.tokenId);
		for (const rawEvent of events) {
			const confidence = scoreReconEvent({
				rawEvent,
				tradeTimestamp,
				expectedUsdcDelta,
				walletAddress,
				usdcDecimals,
				usdcTolerance,
				timeCloseMs,
				timeMaxMs,
			});
			if (confidence === null) {
				continue;
			}

			if (!bestMatch || confidence > bestMatch.confidence) {
				bestMatch = {
					event: rawEvent,
					confidence,
					tokenId: token.tokenId,
				};
			}
		}
	}

	return bestMatch;
}
