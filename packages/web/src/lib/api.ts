import { z } from "zod";
import {
	DashboardStateSchema,
	OkResponseSchema,
	PaperStatsResponseSchema,
	TradeRecordSchema,
} from "@/contracts/schemas";

const API_BASE = import.meta.env.VITE_API_BASE || "/api";
const API_TOKEN = import.meta.env.VITE_API_TOKEN || "";

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
		throw new Error(`API ${res.status}: ${text || res.statusText}`);
	}
	return res.json();
}

async function post<T>(path: string): Promise<T> {
	const res = await fetch(`${API_BASE}${path}`, { method: "POST", headers: { ...authHeaders() } });
	if (!res.ok) {
		const text = await res.text().catch(() => "");
		throw new Error(`API ${res.status}: ${text || res.statusText}`);
	}
	return res.json();
}

export const api = {
	getState: () => get<unknown>("/state").then((d) => DashboardStateSchema.parse(d)),
	getTrades: (mode: string) => get<unknown>(`/logs?mode=${mode}`).then((d) => z.array(TradeRecordSchema).parse(d)),
	getPaperStats: () => get<unknown>("/paper-stats").then((d) => PaperStatsResponseSchema.parse(d)),
	getLiveStats: () => get<unknown>("/live-stats").then((d) => PaperStatsResponseSchema.parse(d)),
	paperStart: () => post<unknown>("/paper/start").then((d) => OkResponseSchema.parse(d)),
	paperStop: () => post<unknown>("/paper/stop").then((d) => OkResponseSchema.parse(d)),
	paperCancel: () => post<unknown>("/paper/cancel").then((d) => OkResponseSchema.parse(d)),
	liveStart: () => post<unknown>("/live/start").then((d) => OkResponseSchema.parse(d)),
	liveStop: () => post<unknown>("/live/stop").then((d) => OkResponseSchema.parse(d)),
	liveCancel: () => post<unknown>("/live/cancel").then((d) => OkResponseSchema.parse(d)),
	paperClearStop: () => post<unknown>("/paper/clear-stop").then((d) => OkResponseSchema.parse(d)),
	paperReset: () => post<unknown>("/paper/reset").then((d) => OkResponseSchema.parse(d)),
	liveReset: () => post<unknown>("/live/reset").then((d) => OkResponseSchema.parse(d)),
};
