import type {
	AccountStatsDto,
	StateSnapshotPayload,
	StatusDto,
	TradeRecordDto,
	WindowSnapshotDto,
} from "@orakel/shared/contracts";
import type { DashboardState, MarketSnapshot, PaperTradeEntry, TodayStats, TradeRecord } from "@/contracts/http";

function toNumber(value: unknown, fallback = 0): number {
	if (typeof value === "number") return Number.isFinite(value) ? value : fallback;
	if (typeof value === "string") {
		const parsed = Number(value);
		return Number.isFinite(parsed) ? parsed : fallback;
	}
	return fallback;
}

export function marketIdFromSlug(slug: string): string {
	const lower = slug.toLowerCase();
	if (lower.startsWith("btc-")) return "BTC-5m";
	if (lower.startsWith("eth-")) return "ETH-5m";
	return slug;
}

export function mapWindowToMarketSnapshot(window: WindowSnapshotDto): MarketSnapshot {
	const modelProbUp = window.modelProbUp ?? 0.5;
	const marketProbUp = window.marketProbUp ?? 0.5;
	const edgeUp = window.edgeUp ?? modelProbUp - marketProbUp;
	const edgeDown = window.edgeDown ?? marketProbUp - modelProbUp;
	const edge = Math.max(edgeUp, edgeDown);
	const predictLong = Math.round(modelProbUp * 100);
	const predictShort = 100 - predictLong;
	const side = edgeUp >= edgeDown ? "UP" : "DOWN";
	const decision = window.decision ?? "SKIP";

	return {
		id: marketIdFromSlug(window.slug),
		label: window.slug,
		ok: true,
		error: undefined,
		spotPrice: window.btcPrice,
		currentPrice: window.btcPrice,
		priceToBeat: window.priceToBeat,
		marketUp: window.marketProbUp,
		marketDown: window.marketProbUp !== null ? 1 - window.marketProbUp : null,
		predictLong,
		predictShort,
		predictDirection: modelProbUp > 0.5 ? "LONG" : modelProbUp < 0.5 ? "SHORT" : "NEUTRAL",
		timeLeftMin: window.timeLeftSeconds / 60,
		phase: window.phase,
		action: decision.startsWith("ENTER") ? "ENTER" : "HOLD",
		side,
		edge,
		reason: null,
		volatility15m: window.volatility,
		spotDelta: window.deviation,
		confidence: {
			score: Math.max(0, Math.min(1, Math.abs(edge))),
			level: Math.abs(edge) >= 0.08 ? "HIGH" : Math.abs(edge) >= 0.04 ? "MEDIUM" : "LOW",
		},
	};
}

function statsToToday(stats: AccountStatsDto | null | undefined): TodayStats | undefined {
	if (!stats) return undefined;
	const limit = stats.dailyMaxLoss > 0 ? stats.dailyMaxLoss : 100;
	return {
		pnl: stats.todayPnl,
		trades: stats.todayTrades,
		limit,
	};
}

export function mapStatusToDashboard(status: StatusDto): DashboardState {
	const markets = status.currentWindow ? [mapWindowToMarketSnapshot(status.currentWindow)] : [];
	return {
		markets,
		updatedAt: new Date().toISOString(),
		paperRunning: status.paperRunning,
		liveRunning: status.liveRunning,
		paperPendingStart: status.paperPendingStart,
		paperPendingStop: status.paperPendingStop,
		livePendingStart: status.livePendingStart,
		livePendingStop: status.livePendingStop,
		paperStats: null,
		liveStats: null,
	};
}

export function mapStateSnapshotToDashboardPatch(payload: StateSnapshotPayload): Partial<DashboardState> {
	return {
		updatedAt: payload.updatedAt,
		markets: payload.currentWindow ? [mapWindowToMarketSnapshot(payload.currentWindow)] : [],
		paperRunning: payload.paperRunning,
		liveRunning: payload.liveRunning,
		paperPendingStart: payload.paperPendingStart,
		paperPendingStop: payload.paperPendingStop,
		livePendingStart: payload.livePendingStart,
		livePendingStop: payload.livePendingStop,
		paperStats: payload.paperStats,
		liveStats: payload.liveStats,
		todayStats: statsToToday(payload.paperStats),
		liveTodayStats: statsToToday(payload.liveStats),
	};
}

export function mapStateSnapshotToDashboard(payload: StateSnapshotPayload): DashboardState {
	return {
		updatedAt: payload.updatedAt,
		markets: payload.currentWindow ? [mapWindowToMarketSnapshot(payload.currentWindow)] : [],
		paperRunning: payload.paperRunning,
		liveRunning: payload.liveRunning,
		paperPendingStart: payload.paperPendingStart,
		paperPendingStop: payload.paperPendingStop,
		livePendingStart: payload.livePendingStart,
		livePendingStop: payload.livePendingStop,
		paperStats: payload.paperStats,
		liveStats: payload.liveStats,
		todayStats: statsToToday(payload.paperStats),
		liveTodayStats: statsToToday(payload.liveStats),
	};
}

export function mapTradeRecordDtoToTradeRecord(row: TradeRecordDto): TradeRecord {
	const pnl = row.pnlUsdc === null ? null : toNumber(row.pnlUsdc, 0);
	const won = row.outcome === "WIN" ? 1 : row.outcome === "LOSS" ? 0 : null;
	const priceCents = Math.round(toNumber(row.price, 0) * 100);
	const size = toNumber(row.size, 0);

	return {
		timestamp: row.createdAt,
		market: marketIdFromSlug(row.windowSlug),
		marketSlug: row.windowSlug,
		side: row.side,
		amount: size.toFixed(2),
		price: String(priceCents),
		orderId: row.orderId ?? `trade-${row.id}`,
		status: row.outcome ? row.outcome.toLowerCase() : "open",
		mode: row.mode,
		pnl,
		won,
		currentPriceAtEntry: toNumber(row.entryBtcPrice, 0),
	};
}

export function mapTradeRecordToPaperTradeEntry(trade: TradeRecord): PaperTradeEntry {
	return {
		id: trade.orderId,
		marketId: trade.market,
		windowStartMs: new Date(trade.timestamp).getTime(),
		side: trade.side.includes("UP") ? "UP" : "DOWN",
		price: toNumber(trade.price, 0) / 100,
		size: toNumber(trade.amount, 0),
		priceToBeat: trade.currentPriceAtEntry ?? 0,
		currentPriceAtEntry: trade.currentPriceAtEntry,
		timestamp: trade.timestamp,
		resolved: trade.won !== null,
		won: trade.won === null ? null : trade.won === 1,
		pnl: trade.pnl,
		settlePrice: null,
	};
}
