import type { ConfigPayload, DashboardState, PaperStatsResponse, TradeRecord } from "@/contracts/http";

// Use fetch directly to avoid Hono version mismatch between web and root
const API_BASE = import.meta.env.VITE_API_BASE || "/api";
const API_TOKEN = import.meta.env.VITE_API_TOKEN || "";

function authHeaders(): Record<string, string> {
	if (!API_TOKEN) return {};
	return { Authorization: `Bearer ${API_TOKEN}` };
}

/** Expose token for WebSocket authentication (query param) */
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

async function _postJson<T>(path: string, data: unknown): Promise<T> {
	const res = await fetch(`${API_BASE}${path}`, {
		method: "POST",
		headers: { "Content-Type": "application/json", ...authHeaders() },
		body: JSON.stringify(data),
	});
	if (!res.ok) {
		const text = await res.text().catch(() => "");
		throw new Error(`API ${res.status}: ${text || res.statusText}`);
	}
	return res.json();
}

async function put<T>(path: string, data: unknown): Promise<T> {
	const res = await fetch(`${API_BASE}${path}`, {
		method: "PUT",
		headers: { "Content-Type": "application/json", ...authHeaders() },
		body: JSON.stringify(data),
	});
	if (!res.ok) {
		const text = await res.text().catch(() => "");
		throw new Error(`API ${res.status}: ${text || res.statusText}`);
	}
	return res.json();
}

export const api = {
	getState: () => get<DashboardState>("/state"),
	getTrades: (mode: string) => get<TradeRecord[]>(`/logs?mode=${mode}`),
	getPaperStats: () => get<PaperStatsResponse>("/paper-stats"),
	getLiveStats: () => get<PaperStatsResponse>("/live-stats"),
	saveConfig: (data: ConfigPayload) => put<{ ok: boolean }>("/config", data),
	paperStart: () => post<{ ok: boolean }>("/paper/start"),
	paperStop: () => post<{ ok: boolean }>("/paper/stop"),
	paperCancel: () => post<{ ok: boolean }>("/paper/cancel"),
	liveStart: () => post<{ ok: boolean }>("/live/start"),
	liveStop: () => post<{ ok: boolean }>("/live/stop"),
	liveCancel: () => post<{ ok: boolean }>("/live/cancel"),
	paperClearStop: () => post<{ ok: boolean }>("/paper/clear-stop"),
	paperReset: () => post<{ ok: boolean }>("/paper/reset"),
	liveReset: () => post<{ ok: boolean }>("/live/reset"),
};
