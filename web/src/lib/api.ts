import type { AppType } from "@server/api";
import { hc } from "hono/client";

const client = hc<AppType>("/api");

export const api = {
	getState: () => client.state.$get().then((r) => r.json()),
	getTrades: (mode: string) =>
		client.trades.$get({ query: { mode } }).then((r) => r.json()),
	getPaperStats: () => client["paper-stats"].$get().then((r) => r.json()),
	saveConfig: (data: Parameters<typeof client.config.$put>[0]["json"]) =>
		client.config.$put({ json: data }).then((r) => r.json()),
	paperStart: () => client.paper.start.$post().then((r) => r.json()),
	paperStop: () => client.paper.stop.$post().then((r) => r.json()),
	paperCancel: () => client.paper.cancel.$post().then((r) => r.json()),
	liveStart: () => client.live.start.$post().then((r) => r.json()),
	liveStop: () => client.live.stop.$post().then((r) => r.json()),
	liveCancel: () => client.live.cancel.$post().then((r) => r.json()),
};

export type DashboardState = Awaited<ReturnType<typeof api.getState>>;
export type TradeRecord = Awaited<ReturnType<typeof api.getTrades>>[number];
export type PaperStatsResponse = Awaited<ReturnType<typeof api.getPaperStats>>;
export type MarketSnapshot = DashboardState["markets"][number];
export type PaperStats = NonNullable<DashboardState["paperStats"]>;
export type ConfigResponse = DashboardState["config"];
export type StrategyConfig = ConfigResponse["strategy"];
export type RiskConfig = ConfigResponse["paperRisk"];
export type PaperTradeEntry = PaperStatsResponse["trades"][number];
export type MarketBreakdown = PaperStatsResponse["byMarket"][string];
export type ConfigPayload = Parameters<typeof api.saveConfig>[0];
