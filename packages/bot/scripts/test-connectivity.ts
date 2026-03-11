#!/usr/bin/env bun
import { z } from "zod";
import { createLogger } from "../src/core/logger.ts";
import { CONFIG } from "../src/core/config.ts";

const log = createLogger("test-connectivity");

const DEFAULT_TIMEOUT_MS = 10_000;

interface RequestResult {
	statusCode: number | null;
	latencyMs: number | null;
	success: boolean;
	error?: string;
	data?: unknown;
}

interface EndpointTest {
	name: string;
	url: string | URL;
	method?: string;
	body?: unknown;
	headers?: Record<string, string>;
}

async function measureRequest(
	url: string | URL,
	options: RequestInit = {},
	timeoutMs: number = DEFAULT_TIMEOUT_MS,
): Promise<RequestResult> {
	const start = performance.now();
	const controller = new AbortController();
	const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

	try {
		const response = await fetch(url, {
			...options,
			signal: controller.signal,
		});

		const end = performance.now();
		const latencyMs = Math.round(end - start);
		const success = response.status >= 200 && response.status < 400;

		let data: unknown;
		const contentType = response.headers.get("content-type");
		if (contentType?.includes("application/json")) {
			data = await response.json();
		}

		return {
			statusCode: response.status,
			latencyMs,
			success,
			data,
		};
	} catch (err) {
		const end = performance.now();
		const latencyMs = Math.round(end - start);

		if (err instanceof Error && err.name === "AbortError") {
			return {
				statusCode: null,
				latencyMs,
				success: false,
				error: `Timeout after ${timeoutMs}ms`,
			};
		}

		return {
			statusCode: null,
			latencyMs,
			success: false,
			error: err instanceof Error ? err.message : String(err),
		};
	} finally {
		clearTimeout(timeoutId);
	}
}

function printResult(result: RequestResult): void {
	console.log(`  Status: ${result.statusCode ?? "N/A"}`);
	console.log(`  Latency: ${result.latencyMs !== null ? `${result.latencyMs}ms` : "Failed"}`);
	console.log(`  Success: ${result.success ? "✓" : "✗"}`);
	if (result.error) console.log(`  Error: ${result.error}`);
}

async function testPolymarketApi(): Promise<void> {
	console.log("\n=== Polymarket CLOB API Test ===\n");

	const endpoints: EndpointTest[] = [
		{ name: "Markets", url: new URL("/markets?limit=1", CONFIG.clobBaseUrl) },
		{ name: "Markets (Active)", url: new URL("/markets?active=true&limit=1", CONFIG.clobBaseUrl) },
	];

	for (const endpoint of endpoints) {
		console.log(`Testing: ${endpoint.name}`);
		console.log(`  URL: ${endpoint.url}`);
		const result = await measureRequest(endpoint.url);
		printResult(result);
		console.log("");
	}
}

const GammaMarketSchema = z
	.object({
		slug: z.string(),
		question: z.string().optional(),
		bestBid: z.coerce.number().optional(),
		bestAsk: z.coerce.number().optional(),
	})
	.passthrough();

async function testPolymarketGamma(): Promise<void> {
	console.log("=== Polymarket Gamma API Test ===\n");

	const url = new URL("/markets", CONFIG.gammaBaseUrl);
	url.searchParams.set("active", "true");
	url.searchParams.set("limit", "1");

	console.log("Testing: Gamma Markets");
	console.log(`  URL: ${url}`);

	const result = await measureRequest(url);
	printResult(result);

	if (result.success && result.data) {
		const markets = z.array(GammaMarketSchema).safeParse(result.data);
		if (markets.success && markets.data.length > 0) {
			const market = markets.data[0];
			console.log(`  Markets fetched: ${markets.data.length}`);
			console.log(`  Sample: ${market.question ?? market.slug}`);
		}
	}
	console.log("");
}

async function testRpcEndpoints(): Promise<void> {
	console.log("=== RPC Endpoints Latency Test ===\n");

	const rpcEndpoints: EndpointTest[] = [
		{ name: "Ethereum Mainnet (Llamarpc)", url: "https://eth.llamarpc.com" },
		{ name: "Polygon Mainnet (Publicnode)", url: "https://polygon-bor-rpc.publicnode.com" },
	];

	for (const endpoint of rpcEndpoints) {
		console.log(`Testing: ${endpoint.name}`);
		console.log(`  URL: ${endpoint.url}`);

		const payload = {
			jsonrpc: "2.0",
			method: "eth_blockNumber",
			params: [],
			id: 1,
		};

		const result = await measureRequest(endpoint.url, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify(payload),
		});

		printResult(result);

		if (result.success && result.data) {
			const RpcResponseSchema = z.object({
				result: z.string().optional(),
			});
			const parsed = RpcResponseSchema.safeParse(result.data);
			if (parsed.success && parsed.data.result) {
				console.log(`  Block Number: ${parsed.data.result}`);
			}
		}
		console.log("");
	}
}

async function testCoinbaseApi(): Promise<void> {
	console.log("=== Coinbase API Test ===\n");

	const COINBASE_BASE_URL = "https://api.exchange.coinbase.com";

	const url = new URL("/products/BTC-USD/ticker", COINBASE_BASE_URL);

	console.log("Testing: BTC-USD Ticker");
	console.log(`  URL: ${url}`);

	const result = await measureRequest(url);
	printResult(result);

	if (result.success && result.data) {
		const CoinbaseResponseSchema = z.object({
			trade_id: z.number(),
			price: z.string(),
			size: z.string(),
			time: z.string(),
		});
		const parsed = CoinbaseResponseSchema.safeParse(result.data);
		if (parsed.success) {
			console.log(`  Price: $${parsed.data.price}`);
			console.log(`  Time: ${parsed.data.time}`);
		}
	}
	console.log("");
}

function printHeader(): void {
	console.log("╔═══════════════════════════════════════════════════════════╗");
	console.log("║       Polymarket & Chainlink Connectivity Test           ║");
	console.log("╚═══════════════════════════════════════════════════════════╝");
}

function printFooter(): void {
	console.log("=== Test Complete ===");
}

printHeader();

await testPolymarketApi();
await testPolymarketGamma();
await testRpcEndpoints();
await testCoinbaseApi();

printFooter();
