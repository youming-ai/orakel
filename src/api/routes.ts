import fs from "node:fs";
import { Hono } from "hono";
import { z } from "zod";
import { atomicWriteConfig, reloadConfig, TIMEFRAME_IDS } from "../core/config.ts";
import { getDbDiagnostics, statements } from "../core/db.ts";
import { env } from "../core/env.ts";
import { createLogger } from "../core/logger.ts";
import {
	getMarkets,
	getUpdatedAt,
	isLiveRunning,
	isPaperRunning,
	setLiveRunning,
	setPaperRunning,
} from "../core/state.ts";
import { getAccountSummary, getAllPositions } from "../trading/accountState.ts";
import {
	clearStopFlag,
	getMarketBreakdown,
	getPaperBalance,
	getPaperStats,
	getRecentPaperTrades,
	getStopReason,
	getTodayStats,
	isStopped,
} from "../trading/paperStats.ts";
import { getReconStatus } from "../trading/reconciler.ts";
import {
	connectWallet,
	disconnectWallet,
	getClientStatus,
	getLiveByMarket,
	getLiveDailyState,
	getLiveStats,
	getLiveTodayStats,
	getPaperDailyState,
	getWalletAddress,
} from "../trading/trader.ts";
import { getApiConfigSnapshot } from "./configSnapshot.ts";

const log = createLogger("api");

interface TradeRowSqlite {
	timestamp: string;
	market: string;
	side: string;
	amount: number;
	price: number;
	order_id: string | null;
	status: string | null;
	mode: string;
	pnl: number | null;
	won: number | null;
	timeframe?: string | null;
	slug?: string | null;
}

interface SignalRowSqlite {
	timestamp: string;
	market: string;
	entry_minute: string | number | null;
	time_left_min: string | number | null;
	regime: string | null;
	signal: string | null;
	vol_implied_up: number | null;
	ta_raw_up: number | null;
	blended_up: number | null;
	blend_source: string | null;
	volatility_15m: number | null;
	price_to_beat: number | null;
	binance_chainlink_delta: number | null;
	orderbook_imbalance: number | null;
	model_up: number | null;
	model_down: number | null;
	mkt_up: number | null;
	mkt_down: number | null;
	raw_sum: number | null;
	arbitrage: number | null;
	edge_up: number | null;
	edge_down: number | null;
	recommendation: string | null;
}

function str(v: string | number | null | undefined): string {
	return v === null || v === undefined ? "" : String(v);
}

// ============ Zod schemas for config update API ============

const PartialRecord = z.record(z.string(), z.unknown());
type StrategyMap = Record<string, Record<string, unknown> | undefined>;

const RawConfigFileSchema = z
	.object({
		version: z.number().optional(),
		strategies: z.record(z.string(), PartialRecord.optional()).optional(),
		strategy: PartialRecord.optional(),
		paper: z
			.object({
				risk: PartialRecord.optional(),
				initialBalance: z.number().optional(),
			})
			.passthrough()
			.optional(),
		live: z.object({ risk: PartialRecord.optional() }).passthrough().optional(),
		enabledTimeframes: z.array(z.string()).optional(),
	})
	.passthrough();

type RawConfigFile = z.infer<typeof RawConfigFileSchema>;

const ConfigUpdateBodySchema = z.object({
	strategies: z.record(z.string(), PartialRecord).optional(),
	strategy: PartialRecord.optional(),
	timeframe: z.string().optional(),
	paperRisk: PartialRecord.optional(),
	liveRisk: PartialRecord.optional(),
	enabledTimeframes: z.array(z.string()).optional(),
});

const apiRoutes = new Hono()
	.get("/health", (c) => {
		return c.json({
			ok: true as const,
			timestamp: Date.now(),
			uptime: Math.floor(process.uptime()),
			memory: {
				rss: Math.round(process.memoryUsage().rss / 1024 / 1024),
				heap: Math.round(process.memoryUsage().heapUsed / 1024 / 1024),
			},
		});
	})

	.get("/db/diagnostics", (c) => {
		return c.json({
			ok: true as const,
			diagnostics: getDbDiagnostics(),
		});
	})

	.get("/state", async (c) => {
		const configSnapshot = getApiConfigSnapshot();
		const status = getClientStatus();
		const todayStats = getTodayStats(configSnapshot.paperDailyLossLimitUsdc);
		const stopLoss = getStopReason();
		const liveStats = await getLiveStats();

		return c.json({
			markets: getMarkets(),
			updatedAt: getUpdatedAt(),
			wallet: { address: getWalletAddress(), connected: status.clientReady },
			paperDaily: getPaperDailyState(),
			liveDaily: getLiveDailyState(),
			config: {
				strategy: configSnapshot.strategy,
				strategies: configSnapshot.strategies,
				enabledTimeframes: configSnapshot.enabledTimeframes,
				paperRisk: configSnapshot.paperRisk,
				liveRisk: configSnapshot.liveRisk,
			},
			paperRunning: isPaperRunning(),
			liveRunning: isLiveRunning(),
			paperStats: getPaperStats(),
			liveStats,
			paperBalance: getPaperBalance(),
			liveWallet: {
				address: status.walletAddress ?? null,
				connected: status.walletLoaded,
				clientReady: status.clientReady,
			},
			stopLoss: isStopped() ? stopLoss : null,
			todayStats: todayStats,
			liveTodayStats: getLiveTodayStats(configSnapshot.liveDailyLossLimitUsdc),
		});
	})

	.get("/trades", (c) => {
		const mode = c.req.query("mode");

		const rows = (
			mode === "paper" || mode === "live"
				? statements.getRecentTrades().all({ $mode: mode, $limit: 100 })
				: statements.getAllRecentTrades().all({ $limit: 100 })
		) as TradeRowSqlite[];

		return c.json(
			rows.map((row) => ({
				timestamp: row.timestamp ?? "",
				market: row.market ?? "",
				side: row.side ?? "",
				amount: String(row.amount ?? ""),
				price: String(row.price ?? ""),
				orderId: row.order_id ?? "",
				status: row.status ?? "",
				mode: row.mode ?? "",
				pnl: row.pnl ?? null,
				won: row.won ?? null,
				timeframe: row.timeframe ?? "15m",
				slug: row.slug ?? "",
			})),
		);
	})

	.get("/signals", (c) => {
		const rows = statements.getRecentSignals().all({
			$limit: 200,
		}) as SignalRowSqlite[];

		return c.json(
			rows.map((row) => ({
				timestamp: row.timestamp ?? "",
				entry_minute: str(row.entry_minute),
				time_left_min: str(row.time_left_min),
				regime: row.regime ?? "",
				signal: row.signal ?? "",
				vol_implied_up: str(row.vol_implied_up),
				ta_raw_up: str(row.ta_raw_up),
				blended_up: str(row.blended_up),
				blend_source: row.blend_source ?? "",
				volatility_15m: str(row.volatility_15m),
				price_to_beat: str(row.price_to_beat),
				binance_chainlink_delta: str(row.binance_chainlink_delta),
				orderbook_imbalance: str(row.orderbook_imbalance),
				model_up: str(row.model_up),
				model_down: str(row.model_down),
				mkt_up: str(row.mkt_up),
				mkt_down: str(row.mkt_down),
				raw_sum: str(row.raw_sum),
				arbitrage: str(row.arbitrage),
				edge_up: str(row.edge_up),
				edge_down: str(row.edge_down),
				recommendation: row.recommendation ?? "",
				market: row.market ?? "",
			})),
		);
	})

	.get("/paper-stats", (c) => {
		const configSnapshot = getApiConfigSnapshot();
		return c.json({
			stats: getPaperStats(),
			trades: getRecentPaperTrades(),
			byMarket: getMarketBreakdown(),
			balance: getPaperBalance(),
			stopLoss: getStopReason(),
			todayStats: getTodayStats(configSnapshot.paperDailyLossLimitUsdc),
		});
	})

	.put("/config", async (c) => {
		try {
			const body = ConfigUpdateBodySchema.parse(await c.req.json());
			const currentConfig = RawConfigFileSchema.parse(JSON.parse(fs.readFileSync("./config.json", "utf8")));

			const updated: RawConfigFile = { ...currentConfig };

			if (currentConfig.version === 2) {
				const currentStrategies = currentConfig.strategies ?? {};
				if (body.strategies) {
					const merged: StrategyMap = { ...currentStrategies };
					for (const tf of TIMEFRAME_IDS) {
						const incoming = body.strategies[tf];
						if (incoming && typeof incoming === "object") {
							merged[tf] = { ...(currentStrategies[tf] ?? {}), ...incoming };
						}
					}
					updated.strategies = merged;
				}
				if (body.strategy && body.timeframe) {
					const allStrats: StrategyMap = { ...(updated.strategies ?? currentStrategies) };
					allStrats[body.timeframe] = { ...(currentStrategies[body.timeframe] ?? {}), ...body.strategy };
					updated.strategies = allStrats;
				}
				if (body.enabledTimeframes) {
					updated.enabledTimeframes = body.enabledTimeframes;
				}
			} else {
				if (body.strategy) {
					updated.strategy = { ...(currentConfig.strategy ?? {}), ...body.strategy };
				}
			}

			if (body.paperRisk) {
				const currentPaper = currentConfig.paper ?? {};
				updated.paper = { ...currentPaper, risk: { ...(currentPaper.risk ?? {}), ...body.paperRisk } };
			}
			if (body.liveRisk) {
				const currentLive = currentConfig.live ?? {};
				updated.live = { ...currentLive, risk: { ...(currentLive.risk ?? {}), ...body.liveRisk } };
			}

			await atomicWriteConfig("./config.json", updated);

			reloadConfig();
			const configSnapshot = getApiConfigSnapshot();

			return c.json({
				ok: true as const,
				config: {
					strategy: configSnapshot.strategy,
					strategies: configSnapshot.strategies,
					enabledTimeframes: configSnapshot.enabledTimeframes,
					paperRisk: configSnapshot.paperRisk,
					liveRisk: configSnapshot.liveRisk,
				},
			});
		} catch (error) {
			return c.json(
				{
					ok: false as const,
					error: error instanceof Error ? error.message : "Failed to update config",
				},
				400,
			);
		}
	})

	.post("/paper/start", (c) => {
		setPaperRunning(true);
		return c.json({ ok: true as const, paperRunning: true });
	})

	.post("/paper/stop", (c) => {
		setPaperRunning(false);
		return c.json({ ok: true as const, paperRunning: false });
	})

	.post("/paper/clear-stop", (c) => {
		log.info(`POST /paper/clear-stop — manually clearing stop loss flag`);
		clearStopFlag();
		return c.json({
			ok: true as const,
			message: "Stop loss flag cleared",
		});
	})

	.post("/live/connect", async (c) => {
		if (!env.API_TOKEN) {
			log.warn(
				"WARNING: /live/connect called without API_TOKEN configured. Set API_TOKEN env var to protect this endpoint.",
			);
		}
		try {
			const body = await c.req.json();
			const configSnapshot = getApiConfigSnapshot();
			const privateKey = typeof body.privateKey === "string" ? body.privateKey : "";
			const result = await connectWallet(privateKey, configSnapshot.clobBaseUrl);
			return c.json({ ok: true as const, address: result.address });
		} catch (err) {
			const msg = err instanceof Error ? err.message : "Unknown error";
			return c.json({ ok: false as const, error: msg }, 400);
		}
	})

	.post("/live/disconnect", (c) => {
		setLiveRunning(false);
		disconnectWallet();
		return c.json({ ok: true as const, liveRunning: false });
	})

	.post("/live/start", (c) => {
		const status = getClientStatus();
		if (!status.walletLoaded || !status.clientReady) {
			return c.json(
				{
					ok: false as const,
					error: "Wallet not connected. Use POST /api/live/connect first.",
				},
				400,
			);
		}
		setLiveRunning(true);
		return c.json({ ok: true as const, liveRunning: true });
	})

	.post("/live/stop", (c) => {
		setLiveRunning(false);
		return c.json({ ok: true as const, liveRunning: false });
	})

	.get("/live/balance", (c) => {
		const summary = getAccountSummary();
		if (!summary.walletAddress) {
			return c.json({ ok: false as const, error: "Account state not initialized" }, 503);
		}
		return c.json({ ok: true as const, data: summary });
	})

	.get("/live/positions", (c) => {
		return c.json({ ok: true as const, data: getAllPositions() });
	})

	.get("/live/recon-status", (c) => {
		return c.json({ ok: true as const, data: getReconStatus() });
	})

	.get("/live/market-breakdown", async (c) => {
		const breakdown = await getLiveByMarket();
		return c.json({ ok: true as const, data: breakdown });
	});

export type AppType = typeof apiRoutes;

export { apiRoutes };
