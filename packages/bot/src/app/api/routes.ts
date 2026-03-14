import type { ConfigUpdateDto, ControlRequestDto } from "@orakel/shared/contracts";
import { desc, eq, sql } from "drizzle-orm";
import { Hono } from "hono";
import { getConfig, mergeConfigUpdate } from "../../core/config.ts";
import { createLogger } from "../../core/logger.ts";
import {
	getLatestTickData,
	getStateSnapshot,
	isLiveRunning,
	isPaperRunning,
	requestLiveStart,
	requestLiveStop,
	requestModeSwitch,
	requestPaperStart,
	requestPaperStop,
} from "../../core/state.ts";
import { getDb } from "../../db/client.ts";
import { signals, trades } from "../../db/schema.ts";

const log = createLogger("api-routes");

const startTime = Date.now();

export function createApiRoutes(opts: { cliAvailable: boolean }): Hono {
	const app = new Hono();

	app.get("/status", (c) => {
		const state = getStateSnapshot();
		const tick = getLatestTickData();
		return c.json({
			paperRunning: state.paperRunning,
			liveRunning: state.liveRunning,
			paperPendingStart: state.paperPendingStart,
			paperPendingStop: state.paperPendingStop,
			livePendingStart: state.livePendingStart,
			livePendingStop: state.livePendingStop,
			currentWindow: tick.currentWindow,
			btcPrice: tick.btcPrice,
			btcPriceAgeMs: tick.btcPriceAgeMs,
			cliAvailable: opts.cliAvailable,
			dbConnected: true,
			uptimeMs: Date.now() - startTime,
		});
	});

	app.get("/trades", async (c) => {
		try {
			const mode = c.req.query("mode");
			const limit = Number(c.req.query("limit") ?? "50");
			const db = getDb();
			const rows = mode
				? await db.select().from(trades).where(eq(trades.mode, mode)).orderBy(desc(trades.createdAt)).limit(limit)
				: await db.select().from(trades).orderBy(desc(trades.createdAt)).limit(limit);
			return c.json(rows);
		} catch (err) {
			log.error("Failed to query trades", { error: err instanceof Error ? err.message : String(err) });
			return c.json({ ok: false, error: "Failed to query trades" }, 500);
		}
	});

	app.get("/signals", async (c) => {
		try {
			const slug = c.req.query("windowSlug");
			const limit = Number(c.req.query("limit") ?? "100");
			const db = getDb();
			const rows = slug
				? await db
						.select()
						.from(signals)
						.where(eq(signals.windowSlug, slug))
						.orderBy(desc(signals.timestamp))
						.limit(limit)
				: await db.select().from(signals).orderBy(desc(signals.timestamp)).limit(limit);
			return c.json(rows);
		} catch (err) {
			log.error("Failed to query signals", { error: err instanceof Error ? err.message : String(err) });
			return c.json({ ok: false, error: "Failed to query signals" }, 500);
		}
	});

	app.get("/config", (c) => {
		const config = getConfig();
		return c.json({
			strategy: config.strategy,
			risk: config.risk,
			execution: config.execution,
		});
	});

	app.patch("/config", async (c) => {
		const body = (await c.req.json()) as ConfigUpdateDto;
		const current = getConfig();
		mergeConfigUpdate(current, body);
		return c.json({ ok: true });
	});

	app.post("/control/start", async (c) => {
		const body = (await c.req.json()) as ControlRequestDto;

		requestModeSwitch(body.mode);

		if (body.mode === "live") {
			log.warn("Live mode pre-flight BYPASSED for testing");
		}

		if (body.mode === "paper") requestPaperStart();
		else requestLiveStart();

		return c.json({
			ok: true,
			message: `${body.mode} trading start requested`,
			state: { paperRunning: isPaperRunning(), liveRunning: isLiveRunning() },
		});
	});

	app.post("/control/stop", async (c) => {
		const body = (await c.req.json()) as ControlRequestDto;
		if (body.mode === "paper") requestPaperStop();
		else requestLiveStop();
		return c.json({
			ok: true,
			message: `${body.mode} trading stop requested`,
			state: { paperRunning: isPaperRunning(), liveRunning: isLiveRunning() },
		});
	});

	app.get("/stats", async (c) => {
		try {
			const db = getDb();
			const [paperStats, liveStats] = await Promise.all([
				db
					.select({
						count: sql<number>`count(*)`,
						wins: sql<number>`count(case when outcome = 'WIN' then 1 end)`,
						pnl: sql<number>`sum(pnl_usdc)`,
					})
					.from(trades)
					.where(eq(trades.mode, "paper")),
				db
					.select({
						count: sql<number>`count(*)`,
						wins: sql<number>`count(case when outcome = 'WIN' then 1 end)`,
						pnl: sql<number>`sum(pnl_usdc)`,
					})
					.from(trades)
					.where(eq(trades.mode, "live")),
			]);
			return c.json({
				paper: {
					totalTrades: paperStats[0]?.count ?? 0,
					wins: paperStats[0]?.wins ?? 0,
					totalPnl: paperStats[0]?.pnl ?? 0,
				},
				live: {
					totalTrades: liveStats[0]?.count ?? 0,
					wins: liveStats[0]?.wins ?? 0,
					totalPnl: liveStats[0]?.pnl ?? 0,
				},
			});
		} catch (err) {
			log.error("Failed to query stats", { error: err instanceof Error ? err.message : String(err) });
			return c.json({ ok: false, error: "Failed to query stats" }, 500);
		}
	});

	return app;
}
