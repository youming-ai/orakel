import { describe, expect, it, vi } from "vitest";

vi.mock("../core/config.ts", () => ({
	CONFIG: {
		paperMode: true,
		strategy: { edgeThresholdMid: 0.1 },
		paperRisk: { maxTradeSizeUsdc: 10 },
		liveRisk: { maxTradeSizeUsdc: 20 },
	},
}));

vi.mock("../core/state.ts", () => ({
	getMarkets: () => [{ id: "BTC-15m", label: "Bitcoin 15m", ok: true }],
	getUpdatedAt: () => "2026-03-07T12:00:00.000Z",
	isPaperRunning: () => true,
	isLiveRunning: () => false,
	isPaperPendingStart: () => false,
	isPaperPendingStop: () => true,
	isLivePendingStart: () => true,
	isLivePendingStop: () => false,
	getPaperPendingSince: () => 111,
	getLivePendingSince: () => 222,
}));

vi.mock("../trading/accountStats.ts", () => ({
	paperAccount: {
		getStats: () => ({ totalTrades: 2, wins: 1, losses: 1, pending: 0, winRate: 0.5, totalPnl: 3 }),
		getTodayStats: () => ({ pnl: 3, trades: 2, limit: 100 }),
		getBalance: () => ({ initial: 1000, current: 1003, maxDrawdown: 5 }),
		isStopped: () => false,
		getStopReason: () => null,
	},
	liveAccount: {
		getStats: () => ({ totalTrades: 1, wins: 1, losses: 0, pending: 0, winRate: 1, totalPnl: 5 }),
		getTodayStats: () => ({ pnl: 5, trades: 1, limit: 100 }),
		getBalance: () => ({ initial: 1000, current: 1005, maxDrawdown: 2 }),
		isStopped: () => false,
		getStopReason: () => null,
	},
}));

vi.mock("../trading/trader.ts", () => ({
	getWalletAddress: () => "0xabc",
	getClientStatus: () => ({ walletLoaded: true, clientReady: false }),
}));

describe("state payload builders", () => {
	it("should keep HTTP and WS shared state fields aligned", async () => {
		const { buildDashboardStateDto, buildStateSnapshotPayload } = await import("../app/api/statePayload.ts");

		const http = buildDashboardStateDto();
		const ws = buildStateSnapshotPayload();

		expect(http.markets).toEqual(ws.markets);
		expect(http.updatedAt).toBe(ws.updatedAt);
		expect(http.paperRunning).toBe(ws.paperRunning);
		expect(http.liveRunning).toBe(ws.liveRunning);
		expect(http.paperPendingStart).toBe(ws.paperPendingStart);
		expect(http.paperPendingStop).toBe(ws.paperPendingStop);
		expect(http.livePendingStart).toBe(ws.livePendingStart);
		expect(http.livePendingStop).toBe(ws.livePendingStop);
		expect(http.paperPendingSince).toBe(ws.paperPendingSince);
		expect(http.livePendingSince).toBe(ws.livePendingSince);
		expect(http.paperStats).toEqual(ws.paperStats);
		expect(http.liveStats).toEqual(ws.liveStats);
		expect(http.paperBalance).toEqual(ws.paperBalance);
		expect(http.liveBalance).toEqual(ws.liveBalance);
		expect(http.todayStats).toEqual(ws.todayStats);
		expect(http.liveTodayStats).toEqual(ws.liveTodayStats);
		expect(http.stopLoss).toEqual(ws.stopLoss);
		expect(http.liveStopLoss).toEqual(ws.liveStopLoss);
	});
});
