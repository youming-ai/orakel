import type { TrackedOrder } from "./orderManager.ts";

export function normalizeTrackedOrderUpdate(
	order: TrackedOrder,
	orderResult: Record<string, unknown>,
): Pick<TrackedOrder, "status" | "sizeMatched" | "lastChecked"> {
	const rawStatus = String(orderResult.status ?? "")
		.toLowerCase()
		.replace("order_status_", "");
	const sizeMatched = Number(orderResult.size_matched ?? orderResult.sizeMatched ?? 0);

	let status = order.status;
	if (rawStatus === "matched" || rawStatus === "filled" || (sizeMatched > 0 && sizeMatched >= order.size * 0.99)) {
		status = "filled";
	} else if (
		rawStatus === "unmatched" ||
		rawStatus === "canceled" ||
		rawStatus === "cancelled" ||
		rawStatus === "canceled_market_resolved" ||
		rawStatus === "invalid"
	) {
		status = "cancelled";
	} else if (rawStatus === "expired") {
		status = "expired";
	}

	return {
		status,
		sizeMatched,
		lastChecked: Date.now(),
	};
}

export function countsTowardWindowLimit(order: TrackedOrder): boolean {
	return order.status === "placed" || order.status === "filled";
}
