import { z } from "zod";
import {
	DashboardStateSchema,
	OkResponseSchema,
	PaperStatsResponseSchema,
	TradeRecordSchema,
} from "../contracts/schemas";
import { mapStatusToDashboard, mapTradeRecordDtoToTradeRecord, mapTradeRecordToPaperTradeEntry } from "./mappers";
import { TradeRecordSchema as TradeRecordDtoSchema } from "./schemas";
import { buildMarketFromTrades, buildStatsFromTrades } from "./stats";

const API_BASE = import.meta.env.VITE_API_BASE || "/api";
const API_TOKEN = import.meta.env.VITE_API_TOKEN || "";

export class ApiError extends Error {
	constructor(
		message: string,
		public readonly statusCode?: number,
		public readonly response?: Response,
	) {
		super(message);
		this.name = "ApiError";
	}
}

function authHeaders(): Record<string, string> {
	if (!API_TOKEN) return {};
	return { Authorization: `Bearer ${API_TOKEN}` };
}

export function getApiToken(): string {
	return API_TOKEN;
}

async function get<T>(path: string): Promise<T> {
	const res = await fetch(`${API_BASE}${path}`, { headers: { ...authHeaders() } });
	if (!res.ok) {
		const text = await res.text().catch(() => "");
		throw new ApiError(`API ${res.status}: ${text || res.statusText}`, res.status, res);
	}
	return res.json();
}

async function post<T>(path: string, body?: unknown): Promise<T> {
	const res = await fetch(`${API_BASE}${path}`, {
		method: "POST",
		headers: {
			...authHeaders(),
			"Content-Type": "application/json",
		},
		body: body ? JSON.stringify(body) : undefined,
	});
	if (!res.ok) {
		const text = await res.text().catch(() => "");
		throw new ApiError(`API ${res.status}: ${text || res.statusText}`, res.status, res);
	}
	return res.json();
}

async function fetchTrades(mode: string, limit = 200) {
	const response = await fetch(`${API_BASE}/trades?mode=${mode}&limit=${limit}`, {
		headers: { ...authHeaders() },
	});

	if (!response.ok) {
		throw new ApiError(`Failed to fetch trades: ${response.statusText}`, response.status, response);
	}

	const data = await response.json();

	// Validate with Zod
	const result = z.array(TradeRecordDtoSchema).safeParse(data);
	if (!result.success) {
		console.error("Invalid trade data from API:", result.error);
		throw new ApiError("Invalid trade data received from server");
	}

	return result.data.map(mapTradeRecordDtoToTradeRecord);
}

async function fetchStatsResponse(mode: "paper" | "live") {
	const trades = await fetchTrades(mode);
	const paperTrades = trades.map((trade) => mapTradeRecordToPaperTradeEntry(trade));
	const stats = buildStatsFromTrades(paperTrades);
	const byMarket = buildMarketFromTrades(paperTrades);
	const todayStats = {
		pnl: stats.todayPnl,
		trades: stats.todayTrades,
		limit: stats.dailyMaxLoss > 0 ? stats.dailyMaxLoss : 100,
	};
	return PaperStatsResponseSchema.parse({
		stats,
		trades: paperTrades,
		byMarket,
		stopLoss: null,
		todayStats,
	});
}

export const api = {
	getState: async () => {
		const data = await get<unknown>("/status");
		const mapped = mapStatusToDashboard(data as never);
		return DashboardStateSchema.parse(mapped);
	},
	getTrades: (mode: string) => fetchTrades(mode),
	getPaperStats: () => fetchStatsResponse("paper"),
	getLiveStats: () => fetchStatsResponse("live"),
	paperStart: () => post<unknown>("/control/start", { mode: "paper" }).then((d) => OkResponseSchema.parse(d)),
	paperStop: () => post<unknown>("/control/stop", { mode: "paper" }).then((d) => OkResponseSchema.parse(d)),
	paperCancel: () => post<unknown>("/control/stop", { mode: "paper" }).then((d) => OkResponseSchema.parse(d)),
	liveStart: () => post<unknown>("/control/start", { mode: "live" }).then((d) => OkResponseSchema.parse(d)),
	liveStop: () => post<unknown>("/control/stop", { mode: "live" }).then((d) => OkResponseSchema.parse(d)),
	liveCancel: () => post<unknown>("/control/stop", { mode: "live" }).then((d) => OkResponseSchema.parse(d)),
};
