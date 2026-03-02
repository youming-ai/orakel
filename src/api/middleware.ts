import { createMiddleware } from "hono/factory";
import { env } from "../core/env.ts";

const requireAuth = createMiddleware(async (c, next) => {
	if (!env.API_TOKEN) return next();

	const header = c.req.header("authorization");
	if (!header?.startsWith("Bearer ")) {
		return c.json({ ok: false, error: "Unauthorized: Bearer token required" }, 401);
	}
	if (header.slice(7) !== env.API_TOKEN) {
		return c.json({ ok: false, error: "Unauthorized: invalid token" }, 401);
	}
	return next();
});

const rateBuckets = new Map<string, { tokens: number; lastRefill: number }>();
const RATE_LIMIT = 600;
const RATE_WINDOW_MS = 60_000;

const rateLimit = createMiddleware(async (c, next) => {
	const socketIp =
		(c.env as { requestIP?: (req: Request) => { address: string } | null })?.requestIP?.(c.req.raw)?.address ?? "";
	const isLocalSocket =
		!socketIp ||
		socketIp === "127.0.0.1" ||
		socketIp === "::1" ||
		socketIp === "::ffff:127.0.0.1" ||
		socketIp.startsWith("172.") ||
		socketIp.startsWith("10.");
	const key = isLocalSocket
		? c.req.header("x-forwarded-for")?.split(",")[0]?.trim() || c.req.header("x-real-ip") || socketIp || "local"
		: socketIp;
	const now = Date.now();
	let bucket = rateBuckets.get(key);
	if (!bucket || now - bucket.lastRefill >= RATE_WINDOW_MS) {
		bucket = { tokens: RATE_LIMIT, lastRefill: now };
	}
	if (bucket.tokens <= 0) {
		return c.json({ ok: false, error: "Rate limit exceeded" }, 429);
	}
	bucket.tokens--;
	rateBuckets.set(key, bucket);
	return next();
});

setInterval(() => {
	const cutoff = Date.now() - RATE_WINDOW_MS * 2;
	for (const [k, v] of rateBuckets) {
		if (v.lastRefill < cutoff) rateBuckets.delete(k);
	}
}, RATE_WINDOW_MS);

export { rateLimit, requireAuth };
