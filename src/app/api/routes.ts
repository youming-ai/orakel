import fs from "node:fs";
import { Hono } from "hono";
import { getAccountSummary, getAllPositions } from "../../blockchain/accountState.ts";
import { getReconStatus } from "../../blockchain/reconciler.ts";
import { fetchRedeemablePositions, redeemAll } from "../../blockchain/redeemer.ts";
import { atomicWriteConfig, CONFIG, reloadConfig } from "../../core/config.ts";
import { env } from "../../core/env.ts";
import { createLogger } from "../../core/logger.ts";
import {
	getMarkets,
	getUpdatedAt,
	isLivePendingStart,
	isLivePendingStop,
	isLiveRunning,
	isPaperPendingStart,
	isPaperPendingStop,
	isPaperRunning,
	setLiveRunning,
	setPaperRunning,
} from "../../core/state.ts";
import { tradeQueries } from "../../db/queries.ts";
import { liveAccount, paperAccount } from "../../trading/accountStats.ts";
import { getLiveStartReadinessError } from "../../trading/liveGuards.ts";
import { connectWallet, disconnectWallet, getClientStatus, getWallet, getWalletAddress } from "../../trading/trader.ts";

const log = createLogger("api");

export const apiRoutes = new Hono()
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
			diagnostics: { backend: "postgresql" },
		});
	})
	.get("/state", (c) => {
		const paperTodayStats = paperAccount.getTodayStats();
		const liveTodayStats = liveAccount.getTodayStats();
		const stopLoss = paperAccount.getStopReason();
		const walletAddress = getWalletAddress();
		const clientStatus = getClientStatus();

		return c.json({
			markets: getMarkets(),
			updatedAt: getUpdatedAt(),
			paperMode: CONFIG.paperMode !== false,
			wallet: { address: walletAddress, connected: !!walletAddress },
			paperDaily: { date: new Date().toDateString(), pnl: paperTodayStats.pnl, trades: paperTodayStats.trades },
			liveDaily: { date: new Date().toDateString(), pnl: liveTodayStats.pnl, trades: liveTodayStats.trades },
			config: {
				strategy: CONFIG.strategy,
				paperRisk: CONFIG.paperRisk,
				liveRisk: CONFIG.liveRisk,
			},
			paperRunning: isPaperRunning(),
			liveRunning: isLiveRunning(),
			paperStats: paperAccount.getStats(),
			liveStats: liveAccount.getStats(),
			paperBalance: paperAccount.getBalance(),
			liveBalance: liveAccount.getBalance(),
			liveWallet: {
				address: walletAddress,
				connected: clientStatus.walletLoaded,
				clientReady: clientStatus.clientReady,
			},
			paperPendingStart: isPaperPendingStart(),
			paperPendingStop: isPaperPendingStop(),
			livePendingStart: isLivePendingStart(),
			livePendingStop: isLivePendingStop(),
			paperPendingSince: null,
			livePendingSince: null,
			stopLoss: paperAccount.isStopped() ? stopLoss : null,
			liveStopLoss: liveAccount.isStopped() ? liveAccount.getStopReason() : null,
			todayStats: paperTodayStats,
			liveTodayStats: liveTodayStats,
		});
	})
	.get("/logs", async (c) => {
		const mode = c.req.query("mode");
		const rows =
			mode === "paper" || mode === "live"
				? await tradeQueries.getRecentByMode(mode, 100)
				: await tradeQueries.getAllRecent(100);

		return c.json(
			rows.map((row) => ({
				timestamp: row.timestamp ?? "",
				market: row.market ?? "",
				marketSlug: row.marketSlug ?? null,
				side: row.side ?? "",
				amount: String(row.amount ?? ""),
				price: String(row.price ?? ""),
				orderId: row.orderId ?? "",
				status: row.status ?? "",
				mode: row.mode ?? "",
				pnl: row.pnl ?? null,
				won: row.won ?? null,
				currentPriceAtEntry: row.currentPriceAtEntry ?? null,
			})),
		);
	})
	.get("/paper-stats", (c) => {
		return c.json({
			stats: paperAccount.getStats(),
			trades: paperAccount.getRecentTrades(),
			byMarket: paperAccount.getMarketBreakdown(),
			balance: paperAccount.getBalance(),
			stopLoss: paperAccount.getStopReason(),
			todayStats: paperAccount.getTodayStats(),
		});
	})
	.get("/live-stats", (c) => {
		return c.json({
			stats: liveAccount.getStats(),
			trades: liveAccount.getRecentTrades(),
			byMarket: liveAccount.getMarketBreakdown(),
			balance: liveAccount.getBalance(),
			stopLoss: liveAccount.getStopReason(),
			todayStats: liveAccount.getTodayStats(),
		});
	})
	.put("/config", async (c) => {
		try {
			const body = await c.req.json();
			const currentConfig = JSON.parse(fs.readFileSync("./config.json", "utf8"));
			const updated: Record<string, unknown> = {};

			if (body.strategy && typeof body.strategy === "object") {
				updated.strategy = { ...currentConfig.strategy, ...body.strategy };
			} else {
				updated.strategy = currentConfig.strategy;
			}

			const currentPaper = currentConfig.paper && typeof currentConfig.paper === "object" ? currentConfig.paper : {};
			const currentPaperRisk = currentPaper.risk && typeof currentPaper.risk === "object" ? currentPaper.risk : {};
			if (body.paperRisk && typeof body.paperRisk === "object") {
				updated.paper = {
					...currentPaper,
					risk: { ...currentPaperRisk, ...body.paperRisk },
				};
			} else {
				updated.paper = currentPaper;
			}

			const currentLive = currentConfig.live && typeof currentConfig.live === "object" ? currentConfig.live : {};
			const currentLiveRisk = currentLive.risk && typeof currentLive.risk === "object" ? currentLive.risk : {};
			if (body.liveRisk && typeof body.liveRisk === "object") {
				updated.live = {
					...currentLive,
					risk: { ...currentLiveRisk, ...body.liveRisk },
				};
			} else {
				updated.live = currentLive;
			}

			await atomicWriteConfig("./config.json", updated);
			reloadConfig();

			return c.json({
				ok: true as const,
				config: {
					strategy: CONFIG.strategy,
					paperRisk: CONFIG.paperRisk,
					liveRisk: CONFIG.liveRisk,
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
		return c.json({ ok: true as const, message: "Paper trading started" });
	})
	.post("/paper/stop", (c) => {
		setPaperRunning(false);
		return c.json({ ok: true as const, message: "Paper trading stopped" });
	})
	.post("/paper/cancel", (c) => {
		return c.json({ ok: true as const, message: "Operation cancelled" });
	})
	.post("/paper/clear-stop", (c) => {
		log.info("POST /paper/clear-stop — manually clearing stop loss flag");
		paperAccount.clearStopFlag();
		return c.json({ ok: true as const, message: "Stop loss flag cleared" });
	})
	.post("/live/clear-stop", (c) => {
		log.info("POST /live/clear-stop — manually clearing stop loss flag");
		liveAccount.clearStopFlag();
		return c.json({ ok: true as const, message: "Stop loss flag cleared" });
	})
	.post("/paper/reset", (c) => {
		if (isPaperRunning()) {
			return c.json({ ok: false as const, error: "Cannot reset while paper trading is running. Stop it first." }, 400);
		}
		log.info("POST /paper/reset — resetting all paper trading data");
		paperAccount.resetData();
		return c.json({ ok: true as const, message: "Paper trading data reset" });
	})
	.post("/live/reset", (c) => {
		if (isLiveRunning()) {
			return c.json({ ok: false as const, error: "Cannot reset while live trading is running. Stop it first." }, 400);
		}
		log.info("POST /live/reset — resetting all live trading data");
		liveAccount.resetData();
		return c.json({ ok: true as const, message: "Live trading data reset" });
	})
	.post("/live/connect", async (c) => {
		if (!env.API_TOKEN) {
			log.warn(
				"WARNING: /live/connect called without API_TOKEN configured. Set API_TOKEN env var to protect this endpoint.",
			);
		}
		try {
			const body = await c.req.json();
			const privateKey = typeof body.privateKey === "string" ? body.privateKey : "";
			const result = await connectWallet(privateKey);
			const status = getClientStatus();
			if (!status.walletLoaded || !status.clientReady) {
				return c.json(
					{
						ok: false as const,
						error: "Wallet connected but trading client is not ready. Reconnect and try again.",
					},
					503,
				);
			}
			return c.json({ ok: true as const, address: result.address, clientReady: true });
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
		const clientStatus = getClientStatus();
		const startError = getLiveStartReadinessError({
			walletLoaded: clientStatus.walletLoaded,
			clientReady: clientStatus.clientReady,
			stopLossActive: liveAccount.isStopped(),
		});
		if (startError) {
			return c.json({ ok: false as const, error: startError }, 400);
		}
		setLiveRunning(true);
		return c.json({ ok: true as const, message: "Live trading started" });
	})
	.post("/live/stop", (c) => {
		setLiveRunning(false);
		return c.json({ ok: true as const, message: "Live trading stopped" });
	})
	.post("/live/cancel", (c) => {
		return c.json({ ok: true as const, message: "Operation cancelled" });
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
	.get("/live/recon-status", async (c) => {
		return c.json({ ok: true as const, data: await getReconStatus() });
	})
	.get("/live/redeemable", async (c) => {
		const address = getWalletAddress();
		if (!address) {
			return c.json({ ok: false as const, error: "Wallet not connected" }, 503);
		}
		const positions = await fetchRedeemablePositions(address);
		return c.json({ ok: true as const, data: positions });
	})
	.post("/live/redeem", async (c) => {
		const w = getWallet();
		if (!w) {
			return c.json({ ok: false as const, error: "Wallet not connected" }, 503);
		}
		const results = await redeemAll(w);
		return c.json({ ok: true as const, data: results });
	});

export type AppType = typeof apiRoutes;
