import type { ClobClient } from "@polymarket/clob-client";
import { createLogger } from "../core/logger.ts";
import { loadTrackedOrdersFromDb, syncTrackedOrderToDb } from "./orderManagerPersistence.ts";
import { countsTowardWindowLimit, normalizeTrackedOrderUpdate } from "./orderManagerStatus.ts";

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
		const existingCount = this.orders.size;
		const loadedOrders = await loadTrackedOrdersFromDb(this.orders);
		for (const [orderId, order] of loadedOrders) {
			if (!this.orders.has(orderId)) {
				this.orders.set(orderId, order);
			}
		}
		const loaded = this.orders.size - existingCount;
		if (loaded > 0) log.info(`Loaded ${loaded} pending orders from database`);
		return loaded;
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
		void syncTrackedOrderToDb(trackedOrder);
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
		void syncTrackedOrderToDb(trackedOrder);
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

				const previousStatus = order.status;
				Object.assign(order, normalizeTrackedOrderUpdate(order, orderResult));

				if (order.status === "filled" && previousStatus !== "filled") {
					log.info(`Order ${order.orderId.slice(0, 8)} FILLED: ${order.sizeMatched} / ${order.size}`);
				} else if (order.status === "cancelled" && previousStatus !== "cancelled") {
					log.info(`Order ${order.orderId.slice(0, 8)} CANCELLED`);
				} else if (order.status === "expired" && previousStatus !== "expired") {
					log.info(`Order ${order.orderId.slice(0, 8)} EXPIRED`);
				}

				// Notify callback if status changed (for heartbeat tracking)
				if (order.status !== previousStatus) {
					if (this.onStatusChange) {
						this.onStatusChange(order, order.status, previousStatus);
					}
					void syncTrackedOrderToDb(order);
				}
			} catch (err: unknown) {
				const msg = err instanceof Error ? err.message : String(err);
				log.error(`Poll error for ${order.orderId.slice(0, 8)}:`, msg);
			}
		}
	}

	/**
	 * Cancel an active order via CLOB client. Returns true if cancellation was sent.
	 */
	async cancelOrder(orderId: string): Promise<boolean> {
		const order = this.orders.get(orderId);
		if (!order || order.status !== "placed") return false;
		if (!this.client) {
			log.warn(`Cannot cancel order ${orderId.slice(0, 12)}: no CLOB client`);
			return false;
		}

		try {
			await this.client.cancelOrder({ orderID: orderId });
			const previousStatus = order.status;
			order.status = "cancelled";
			order.lastChecked = Date.now();
			log.info(`Order ${orderId.slice(0, 12)} cancelled`);
			if (this.onStatusChange) {
				this.onStatusChange(order, "cancelled", previousStatus);
			}
			void syncTrackedOrderToDb(order);
			return true;
		} catch (err: unknown) {
			const msg = err instanceof Error ? err.message : String(err);
			log.error(`Failed to cancel order ${orderId.slice(0, 12)}:`, msg);
			return false;
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
			if (order.marketId === marketId && order.windowSlug === windowSlug && countsTowardWindowLimit(order)) {
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
