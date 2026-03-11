import { createLogger } from "../core/logger.ts";
import { pendingOrderQueries } from "../db/queries.ts";
import type { TrackedOrder } from "./orderManager.ts";

const log = createLogger("order-store");

export async function loadTrackedOrdersFromDb(
	existingOrders: Map<string, TrackedOrder>,
): Promise<Map<string, TrackedOrder>> {
	const loadedOrders = new Map(existingOrders);

	try {
		const rows = await pendingOrderQueries.getAll();
		for (const row of rows) {
			if (loadedOrders.has(row.orderId)) continue;
			loadedOrders.set(row.orderId, {
				orderId: row.orderId,
				marketId: row.marketId,
				windowSlug: row.windowStartMs ? String(row.windowStartMs) : "",
				side: row.side,
				price: row.price,
				size: row.size,
				placedAt: row.placedAt,
				status: (row.status as TrackedOrder["status"]) ?? "placed",
				sizeMatched: 0,
				lastChecked: Date.now(),
				tokenId: row.tokenId ?? undefined,
				priceToBeat: row.priceToBeat ?? null,
				currentPriceAtEntry: row.currentPriceAtEntry ?? null,
			});
		}
		return loadedOrders;
	} catch (err) {
		log.warn("Failed to load pending orders from DB:", err instanceof Error ? err.message : String(err));
		return loadedOrders;
	}
}

export async function syncTrackedOrderToDb(order: TrackedOrder): Promise<void> {
	try {
		await pendingOrderQueries.upsert({
			orderId: order.orderId,
			marketId: order.marketId,
			windowStartMs: Number(order.windowSlug) || 0,
			side: order.side,
			price: order.price,
			size: order.size,
			priceToBeat: order.priceToBeat ?? null,
			currentPriceAtEntry: order.currentPriceAtEntry ?? null,
			tokenId: order.tokenId ?? "",
			placedAt: order.placedAt,
			status: order.status,
		});
	} catch (err) {
		log.warn(
			`Failed to sync order ${order.orderId.slice(0, 8)} to DB:`,
			err instanceof Error ? err.message : String(err),
		);
	}
}
