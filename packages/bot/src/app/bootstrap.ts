import { watch } from "node:fs";
import { resolve } from "node:path";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { checkCliAvailable } from "../cli/commands.ts";
import { loadConfigFromFile } from "../core/config.ts";
import { loadEnv } from "../core/env.ts";
import { createLogger } from "../core/logger.ts";
import { applyPendingStarts, applyPendingStops, requestPaperStart } from "../core/state.ts";
import { createBinanceAdapter } from "../data/binance.ts";
import { createBybitAdapter } from "../data/bybit.ts";
import { createOrderBookAdapter } from "../data/polymarket.ts";
import { createPriceAggregator } from "../data/priceAggregator.ts";
import { connectDb } from "../db/client.ts";
import { createMainLoop } from "../runtime/mainLoop.ts";
import { createAccountManager } from "../trading/account.ts";
import { createApiRoutes } from "./api/routes.ts";
import { createWsPublisher } from "./ws.ts";

const log = createLogger("bootstrap");

const CONFIG_PATH = resolve(import.meta.dir, "../../../../config.json");

export async function bootstrapApp(): Promise<void> {
	const env = loadEnv();
	const config = await loadConfigFromFile(CONFIG_PATH);
	await connectDb(env.DATABASE_URL);

	const binance = createBinanceAdapter({
		restUrl: config.infra.binanceRestUrl,
		wsUrl: config.infra.binanceWsUrl,
	});
	const bybit = createBybitAdapter({
		restUrl: config.infra.bybitRestUrl,
		wsUrl: config.infra.bybitWsUrl,
	});
	const priceAdapter = createPriceAggregator(binance, bybit);
	priceAdapter.start();

	const polymarketWs = createOrderBookAdapter(config.infra.polymarketClobWsUrl);

	const cliAvailable = await checkCliAvailable();
	if (!cliAvailable && !env.PAPER_MODE) {
		log.error("Polymarket CLI not available and not in paper mode - aborting");
		process.exit(1);
	}
	log.info("CLI check", { available: cliAvailable });

	const paperAccount = createAccountManager(10000);
	const liveAccount = createAccountManager(0);

	const ws = createWsPublisher();
	const mainLoop = createMainLoop({ priceAdapter, polymarketWs, paperAccount, liveAccount, ws });

	const app = new Hono();
	app.use("*", cors());
	app.route("/api", createApiRoutes({ cliAvailable }));

	const server = Bun.serve({
		port: env.PORT,
		fetch: (req, serverInstance) => {
			const url = new URL(req.url);
			if (url.pathname === "/ws") {
				if (serverInstance.upgrade(req)) {
					return new Response(null);
				}
				return new Response("WebSocket upgrade failed", { status: 400 });
			}
			return app.fetch(req);
		},
		websocket: ws.getWebSocketHandler(),
	});

	log.info("API server started", { port: env.PORT });

	setInterval(() => {
		applyPendingStarts();
		applyPendingStops();
	}, 1000);

	mainLoop.start();

	if (env.PAPER_MODE) {
		requestPaperStart();
		log.info("Auto-started paper trading (PAPER_MODE=true)");
	}

	const watcher = watch(CONFIG_PATH, async () => {
		try {
			await loadConfigFromFile(CONFIG_PATH);
			log.info("Config reloaded");
		} catch (err) {
			log.warn("Config reload failed", { error: err instanceof Error ? err.message : String(err) });
		}
	});

	process.on("SIGINT", () => {
		log.info("Shutting down...");
		mainLoop.stop();
		priceAdapter.stop();
		polymarketWs.stop();
		watcher.close();
		server.stop();
		process.exit(0);
	});
}
