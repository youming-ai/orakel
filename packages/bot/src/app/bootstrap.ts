import { watch } from "node:fs";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { checkCliAvailable } from "../cli/commands.ts";
import { loadConfigFromFile } from "../core/config.ts";
import { loadEnv } from "../core/env.ts";
import { createLogger } from "../core/logger.ts";
import { applyPendingStarts, applyPendingStops } from "../core/state.ts";
import { createChainlinkAdapter } from "../data/chainlink.ts";
import { createOrderBookAdapter } from "../data/polymarket.ts";
import { connectDb } from "../db/client.ts";
import { createMainLoop } from "../runtime/mainLoop.ts";
import { createAccountManager } from "../trading/account.ts";
import { createApiRoutes } from "./api/routes.ts";
import { createWsPublisher } from "./ws.ts";

const log = createLogger("bootstrap");

export async function bootstrapApp(): Promise<void> {
	const env = loadEnv();
	const config = await loadConfigFromFile("./config.json");
	await connectDb(env.DATABASE_URL);

	const chainlink = createChainlinkAdapter({
		httpUrl: config.infra.chainlinkHttpUrl,
		aggregator: config.infra.chainlinkAggregator,
		decimals: config.infra.chainlinkDecimals,
	});
	chainlink.start();

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
	const mainLoop = createMainLoop({ chainlink, polymarketWs, paperAccount, liveAccount, ws });

	const app = new Hono();
	app.use("*", cors());
	app.route("/api", createApiRoutes());

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

	const watcher = watch("./config.json", async () => {
		try {
			await loadConfigFromFile("./config.json");
			log.info("Config reloaded");
		} catch (err) {
			log.warn("Config reload failed", { error: err instanceof Error ? err.message : String(err) });
		}
	});

	process.on("SIGINT", () => {
		log.info("Shutting down...");
		mainLoop.stop();
		chainlink.stop();
		polymarketWs.stop();
		watcher.close();
		server.stop();
		process.exit(0);
	});
}
