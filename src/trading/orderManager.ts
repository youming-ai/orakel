import type { ClobClient } from "@polymarket/clob-client";
import { createLogger } from "./logger.ts";

const log = createLogger("orders");

// Callback type for order status changes
type OrderStatusCallback = (orderId: string, status: TrackedOrder["status"]) => void;

export interface TrackedOrder {
	orderId: string;
	marketId: string;
	windowSlug: string;
	side: string;
	price: number;
	size: number;
	placedAt: number;
	status: "placed" | "live" | "matched" | "filled" | "cancelled" | "expired";
	sizeMatched: number;
	lastChecked: number;
	orderType?: "GTD" | "FOK"; // Track order type for heartbeat management
	tokenId?: string;
}

export class OrderManager {
	private orders: Map<string, TrackedOrder> = new Map();
	private client: ClobClient | null = null;
	private pollIntervalMs: number = 5_000;
	private pollTimer: ReturnType<typeof setInterval> | null = null;
	private onStatusChange: OrderStatusCallback | null = null;

	setClient(client: ClobClient): void {
		this.client = client;
	}

	/** Register callback for order status changes (e.g., to update heartbeat tracking) */
	onOrderStatusChange(callback: OrderStatusCallback): void {
		this.onStatusChange = callback;
	}

	addOrder(order: Omit<TrackedOrder, "status" | "sizeMatched" | "lastChecked">): void {
		this.orders.set(order.orderId, {
			...order,
			status: "placed",
			sizeMatched: 0,
			lastChecked: Date.now(),
		});
	}

	/** Add order with type tracking (GTD orders need heartbeat, FOK orders don't) */
	addOrderWithTracking(
		order: Omit<TrackedOrder, "status" | "sizeMatched" | "lastChecked" | "orderType">,
		isGtdOrder: boolean,
	): void {
		this.orders.set(order.orderId, {
			...order,
			status: "placed",
			sizeMatched: 0,
			lastChecked: Date.now(),
			orderType: isGtdOrder ? "GTD" : "FOK",
		});
	}

	getOrder(orderId: string): TrackedOrder | undefined {
		return this.orders.get(orderId);
	}

	getActiveOrders(): TrackedOrder[] {
		return [...this.orders.values()].filter((o) => o.status === "placed" || o.status === "live");
	}

	getFilledOrders(): TrackedOrder[] {
		return [...this.orders.values()].filter((o) => o.status === "filled" || o.status === "matched");
	}

	async pollOrders(): Promise<void> {
		if (!this.client) return;

		const active = this.getActiveOrders();
		for (const order of active) {
			try {
				const result: unknown = await this.client.getOrder(order.orderId);
				if (!result || typeof result !== "object") continue;
				const orderResult = result as Record<string, unknown>;

				const status = String(orderResult.status ?? "").toLowerCase();
				const sizeMatched = Number(orderResult.size_matched ?? orderResult.sizeMatched ?? 0);
				const previousStatus = order.status;

				if (status === "matched" || (sizeMatched > 0 && sizeMatched >= order.size * 0.99)) {
					order.status = "filled";
					order.sizeMatched = sizeMatched;
					log.info(`Order ${order.orderId.slice(0, 8)} FILLED: ${sizeMatched} / ${order.size}`);
				} else if (status === "live") {
					order.status = "live";
					order.sizeMatched = sizeMatched;
				} else if (status === "unmatched" || status === "cancelled") {
					order.status = "cancelled";
					log.info(`Order ${order.orderId.slice(0, 8)} CANCELLED`);
				}

				order.lastChecked = Date.now();

				// Notify callback if status changed (for heartbeat tracking)
				if (this.onStatusChange && order.status !== previousStatus) {
					this.onStatusChange(order.orderId, order.status);
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
				(order.status === "placed" ||
					order.status === "live" ||
					order.status === "filled" ||
					order.status === "matched")
			) {
				return true;
			}
		}
		return false;
	}

	totalActive(): number {
		return this.getActiveOrders().length + this.getFilledOrders().length;
	}
}
