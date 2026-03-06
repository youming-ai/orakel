import type { ClobClient } from "@polymarket/clob-client";
import { createLogger } from "../core/logger.ts";
import { pendingOrderQueries } from "../db/queries.ts";

const log = createLogger("orders");

// Callback type for order status changes
type OrderStatusCallback = (
	order: TrackedOrder,
	status: TrackedOrder["status"],
	previousStatus: TrackedOrder["status"],
) => void;

export interface TrackedOrder {
	orderId: string;
	marketId: string;
	windowSlug: string;
	side: string;
	price: number;
	size: number;
	placedAt: number;
	status: "placed" | "filled" | "cancelled" | "expired";
	sizeMatched: number;
	lastChecked: number;
	orderType?: "GTD" | "FOK"; // Track order type for heartbeat management
	tokenId?: string;
	priceToBeat?: number | null;
	currentPriceAtEntry?: number | null;
}

export class OrderManager {
	private orders: Map<string, TrackedOrder> = new Map();
	private client: ClobClient | null = null;
	private pollIntervalMs: number = 5_000;
	private pollTimer: ReturnType<typeof setInterval> | null = null;
	private onStatusChange: OrderStatusCallback | null = null;

	constructor() {
		void this.loadFromDb();
	}

	async loadFromDb(): Promise<number> {
		try {
			const rows = await pendingOrderQueries.getAll();
			let loaded = 0;
			for (const row of rows) {
				if (this.orders.has(row.orderId)) continue;
				this.orders.set(row.orderId, {
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
				loaded++;
			}
			if (loaded > 0) log.info(`Loaded ${loaded} pending orders from database`);
			return loaded;
		} catch (err) {
			log.warn("Failed to load pending orders from DB:", err instanceof Error ? err.message : String(err));
			return 0;
		}
	}

	private async syncToDb(order: TrackedOrder): Promise<void> {
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

	setClient(client: ClobClient | null): void {
		this.client = client;
	}

	/** Register callback for order status changes (e.g., to update heartbeat tracking) */
	onOrderStatusChange(callback: OrderStatusCallback): void {
		this.onStatusChange = callback;
	}

	addOrder(order: Omit<TrackedOrder, "status" | "sizeMatched" | "lastChecked">): void {
		const trackedOrder: TrackedOrder = {
			...order,
			status: "placed",
			sizeMatched: 0,
			lastChecked: Date.now(),
		};
		this.orders.set(order.orderId, trackedOrder);
		this.syncToDb(trackedOrder);
	}

	/** Add order with type tracking (GTD orders need heartbeat, FOK orders don't) */
	addOrderWithTracking(
		order: Omit<TrackedOrder, "status" | "sizeMatched" | "lastChecked" | "orderType">,
		isGtdOrder: boolean,
	): void {
		const trackedOrder: TrackedOrder = {
			...order,
			status: "placed",
			sizeMatched: 0,
			lastChecked: Date.now(),
			orderType: isGtdOrder ? "GTD" : "FOK",
		};
		this.orders.set(order.orderId, trackedOrder);
		this.syncToDb(trackedOrder);
	}

	getOrder(orderId: string): TrackedOrder | undefined {
		return this.orders.get(orderId);
	}

	getActiveOrders(): TrackedOrder[] {
		return [...this.orders.values()].filter((o) => o.status === "placed");
	}

	getFilledOrders(): TrackedOrder[] {
		return [...this.orders.values()].filter((o) => o.status === "filled");
	}

	async pollOrders(): Promise<void> {
		if (!this.client) return;

		const active = this.getActiveOrders();
		for (const order of active) {
			try {
				const result: unknown = await this.client.getOrder(order.orderId);
				if (!result || typeof result !== "object") continue;
				const orderResult = result as Record<string, unknown>;

				// Polymarket GET /order/{id} returns "ORDER_STATUS_*" prefixed values,
				// while POST /order returns short lowercase ("live", "matched", etc.).
				// Normalize to short lowercase to handle both formats.
				const rawStatus = String(orderResult.status ?? "")
					.toLowerCase()
					.replace("order_status_", "");
				const sizeMatched = Number(orderResult.size_matched ?? orderResult.sizeMatched ?? 0);
				const previousStatus = order.status;

				if (
					rawStatus === "matched" ||
					rawStatus === "filled" ||
					(sizeMatched > 0 && sizeMatched >= order.size * 0.99)
				) {
					order.status = "filled";
					order.sizeMatched = sizeMatched;
					log.info(`Order ${order.orderId.slice(0, 8)} FILLED: ${sizeMatched} / ${order.size}`);
				} else if (
					rawStatus === "unmatched" ||
					rawStatus === "canceled" ||
					rawStatus === "cancelled" ||
					rawStatus === "canceled_market_resolved" ||
					rawStatus === "invalid"
				) {
					order.status = "cancelled";
					log.info(`Order ${order.orderId.slice(0, 8)} CANCELLED (api: ${rawStatus})`);
				} else if (rawStatus === "expired") {
					order.status = "expired";
					log.info(`Order ${order.orderId.slice(0, 8)} EXPIRED`);
				}
				// "live" status from API is ignored — order stays "placed" until filled/cancelled/expired

				order.lastChecked = Date.now();

				// Notify callback if status changed (for heartbeat tracking)
				if (order.status !== previousStatus) {
					if (this.onStatusChange) {
						this.onStatusChange(order, order.status, previousStatus);
					}
					this.syncToDb(order);
				}
			} catch (err: unknown) {
				const msg = err instanceof Error ? err.message : String(err);
				log.error(`Poll error for ${order.orderId.slice(0, 8)}:`, msg);
			}
		}
	}

	prune(): void {
		const cutoff = Date.now() - 20 * 60_000;
		for (const [id, order] of this.orders) {
			if (
				order.placedAt < cutoff &&
				(order.status === "filled" || order.status === "cancelled" || order.status === "expired")
			) {
				this.orders.delete(id);
			}
		}
	}

	startPolling(intervalMs?: number): void {
		if (this.pollTimer) return;
		this.pollIntervalMs = intervalMs ?? this.pollIntervalMs;
		this.pollTimer = setInterval(() => {
			this.pollOrders().catch((err: unknown) => {
				log.error("Poll cycle error:", err);
			});
		}, this.pollIntervalMs);
	}

	stopPolling(): void {
		if (this.pollTimer) {
			clearInterval(this.pollTimer);
			this.pollTimer = null;
		}
	}

	hasOrderForWindow(marketId: string, windowSlug: string): boolean {
		for (const order of this.orders.values()) {
			if (
				order.marketId === marketId &&
				order.windowSlug === windowSlug &&
				(order.status === "placed" || order.status === "filled")
			) {
				return true;
			}
		}
		return false;
	}

	totalActive(): number {
		return this.getActiveOrders().length + this.getFilledOrders().length;
	}

	/** Sum of price * size for all placed orders (USDC reserved for pending GTD) */
	totalPendingCost(): number {
		let cost = 0;
		for (const order of this.orders.values()) {
			if (order.status === "placed") {
				cost += order.price * order.size;
			}
		}
		return cost;
	}
}
