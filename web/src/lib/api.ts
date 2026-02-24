// Use fetch directly to avoid Hono version mismatch between web and root
const API_BASE = "/api";

async function get<T>(path: string): Promise<T> {
	const res = await fetch(`${API_BASE}${path}`);
	return res.json();
}

async function post<T>(path: string): Promise<T> {
	const res = await fetch(`${API_BASE}${path}`, { method: "POST" });
	return res.json();
}

async function put<T>(path: string, data: unknown): Promise<T> {
	const res = await fetch(`${API_BASE}${path}`, {
		method: "PUT",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify(data),
	});
	return res.json();
}

export const api = {
	getState: () => get<DashboardState>("/state"),
	getTrades: (mode: string) => get<TradeRecord[]>(`/trades?mode=${mode}`),
	getPaperStats: () => get<{ trades: PaperTradeEntry[]; byMarket: Record<string, MarketBreakdown> }>("/paper-stats"),
	saveConfig: (data: ConfigPayload) => put<{ ok: boolean }>("/config", data),
	paperStart: () => post<{ ok: boolean }>("/paper/start"),
	paperStop: () => post<{ ok: boolean }>("/paper/stop"),
	paperCancel: () => post<{ ok: boolean }>("/paper/cancel"),
	liveStart: () => post<{ ok: boolean }>("/live/start"),
	liveStop: () => post<{ ok: boolean }>("/live/stop"),
	liveCancel: () => post<{ ok: boolean }>("/live/cancel"),
};

// Types - defined locally to avoid Hono type import issues
export interface DashboardState {
	markets: MarketSnapshot[];
	paperMode: boolean;
	paperStats: PaperStats | null;
	config: {
		strategy: StrategyConfig;
		paperRisk: RiskConfig;
		liveRisk: RiskConfig;
	};
	updatedAt: string;
	paperRunning: boolean;
	liveRunning: boolean;
	paperPendingStart: boolean;
	paperPendingStop: boolean;
	livePendingStart: boolean;
	livePendingStop: boolean;
	liveWallet: {
		address: string;
		connected: boolean;
		clientReady: boolean;
	} | null;
}

export interface MarketSnapshot {
	id: string;
	label: string;
	ok: boolean;
	error?: string;
	spotPrice: number | null;
	currentPrice: number | null;
	priceToBeat: number | null;
	marketUp: number | null;
	marketDown: number | null;
	rawSum: number | null;
	arbitrage: boolean;
	predictLong: number | null;
	predictShort: number | null;
	predictDirection: "LONG" | "SHORT" | "NEUTRAL";
	haColor: string | null;
	haConsecutive: number;
	rsi: number | null;
	macd: { macd: number; signal: number; hist: number; histDelta: number | null } | null;
	vwapSlope: number | null;
	timeLeftMin: number | null;
	phase: string | null;
	action: string;
	side: string | null;
	edge: number | null;
	strength: string | null;
	reason: string | null;
	volatility15m: number | null;
	blendSource: string | null;
	volImpliedUp: number | null;
	binanceChainlinkDelta: number | null;
	orderbookImbalance: number | null;
}

export interface PaperStats {
	totalTrades: number;
	wins: number;
	losses: number;
	pending: number;
	winRate: number;
	totalPnl: number;
}

export interface StrategyConfig {
	edgeThresholdEarly: number;
	edgeThresholdMid: number;
	edgeThresholdLate: number;
	minProbEarly: number;
	minProbMid: number;
	minProbLate: number;
	blendWeights: { vol: number; ta: number };
	regimeMultipliers: {
		CHOP: number;
		RANGE: number;
		TREND_ALIGNED: number;
		TREND_OPPOSED: number;
	};
}

export interface RiskConfig {
	maxTradeSizeUsdc: number;
	limitDiscount: number;
	dailyMaxLossUsdc: number;
	maxOpenPositions: number;
	minLiquidity: number;
	maxTradesPerWindow: number;
}

export interface PaperTradeEntry {
	id: string;
	marketId: string;
	windowStartMs: number;
	side: "UP" | "DOWN";
	price: number;
	size: number;
	priceToBeat: number;
	currentPriceAtEntry: number | null;
	timestamp: string;
	resolved: boolean;
	won: boolean | null;
	pnl: number | null;
	settlePrice: number | null;
}

export interface MarketBreakdown {
	wins: number;
	losses: number;
	pending: number;
	winRate: number;
	totalPnl: number;
	tradeCount: number;
}

export interface ConfigPayload {
	strategy: StrategyConfig;
	paperRisk?: RiskConfig;
	liveRisk?: RiskConfig;
}

export type TradeRecord = {
	orderId: string;
	timestamp: string;
	market: string;
	side: string;
	amount: string;
	price: string;
	status?: string;
};
