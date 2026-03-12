import { z } from "zod";
import { createLogger } from "../core/logger.ts";
import type { MarketInfo, OrderBookSnapshot } from "../core/types.ts";

const log = createLogger("polymarket");

const GammaMarketSchema = z
	.object({
		slug: z.string(),
		conditionId: z.string().optional(),
		endDate: z.string(),
		eventStartTime: z.string().optional(),
		outcomes: z.union([z.string(), z.array(z.string())]),
		clobTokenIds: z.union([z.string(), z.array(z.string())]),
	})
	.passthrough();

function parseArray(value: unknown): string[] {
	if (Array.isArray(value)) return value.map(String);
	if (typeof value !== "string") return [];
	try {
		const parsed = JSON.parse(value);
		return Array.isArray(parsed) ? parsed.map(String) : [];
	} catch {
		return [];
	}
}

export async function fetchMarketBySlug(slug: string, gammaUrl: string): Promise<MarketInfo | null> {
	try {
		const url = new URL("/markets", gammaUrl);
		url.searchParams.set("slug", slug);
		const res = await fetch(url, { signal: AbortSignal.timeout(5_000) });
		if (!res.ok) return null;
		const data: unknown = await res.json();
		const market = Array.isArray(data) ? data[0] : data;
		if (!market) return null;

		const parsed = GammaMarketSchema.safeParse(market);
		if (!parsed.success) {
			log.warn("Invalid Gamma market data", { slug });
			return null;
		}

		const outcomes = parseArray(parsed.data.outcomes);
		const tokenIds = parseArray(parsed.data.clobTokenIds);
		const upIdx = outcomes.findIndex((o) => o.toLowerCase() === "up");
		const downIdx = outcomes.findIndex((o) => o.toLowerCase() === "down");
		const upTokenId = upIdx >= 0 ? tokenIds[upIdx] : undefined;
		const downTokenId = downIdx >= 0 ? tokenIds[downIdx] : undefined;

		if (!upTokenId || !downTokenId) {
			log.warn("Missing token IDs", { slug, outcomes, tokenIds });
			return null;
		}

		const endMs = new Date(parsed.data.endDate).getTime();
		const startMs = parsed.data.eventStartTime ? new Date(parsed.data.eventStartTime).getTime() : endMs - 300_000;

		return {
			slug: parsed.data.slug,
			conditionId: parsed.data.conditionId ?? "",
			upTokenId,
			downTokenId,
			priceToBeat: 0,
			startMs,
			endMs,
		};
	} catch (err) {
		log.warn("fetchMarketBySlug failed", { slug, error: err instanceof Error ? err.message : String(err) });
		return null;
	}
}

export interface PolymarketOrderBookAdapter {
	getOrderBook(tokenId: string): OrderBookSnapshot | null;
	subscribe(tokenIds: string[]): void;
	stop(): void;
}

export function createOrderBookAdapter(clobWsUrl: string): PolymarketOrderBookAdapter {
	const books = new Map<string, OrderBookSnapshot>();
	let ws: WebSocket | null = null;
	let stopped = false;

	function connect(tokenIds: string[]): void {
		if (stopped) return;
		try {
			ws = new WebSocket(clobWsUrl);
			ws.onopen = () => {
				for (const tokenId of tokenIds) {
					ws?.send(
						JSON.stringify({
							type: "subscribe",
							channel: "best_bid_ask",
							assets_ids: [tokenId],
						}),
					);
				}
				log.info("CLOB WS connected", { tokens: tokenIds.length });
			};
			ws.onmessage = (event) => {
				try {
					const msg = JSON.parse(String(event.data)) as Record<string, unknown>;
					if (msg.event_type === "best_bid_ask") {
						const tokenId = String(msg.asset_id ?? "");
						const bestBid = Number(msg.best_bid ?? 0) || null;
						const bestAsk = Number(msg.best_ask ?? 0) || null;
						const midpoint = bestBid !== null && bestAsk !== null ? (bestBid + bestAsk) / 2 : null;
						const spread = bestBid !== null && bestAsk !== null ? bestAsk - bestBid : null;
						books.set(tokenId, { bestBid, bestAsk, midpoint, spread, timestampMs: Date.now() });
					}
				} catch {
					// ignore parse errors
				}
			};
			ws.onclose = () => {
				if (!stopped) {
					log.warn("CLOB WS disconnected, reconnecting in 3s");
					setTimeout(() => connect(tokenIds), 3_000);
				}
			};
		} catch (err) {
			log.error("CLOB WS connection error", { error: err instanceof Error ? err.message : String(err) });
		}
	}

	return {
		getOrderBook: (tokenId) => books.get(tokenId) ?? null,
		subscribe: (tokenIds) => connect(tokenIds),
		stop: () => {
			stopped = true;
			ws?.close();
		},
	};
}
