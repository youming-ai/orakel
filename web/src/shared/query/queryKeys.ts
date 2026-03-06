import type { ViewMode } from "@/lib/types";

export const queryKeys = {
	state: ["state"] as const,
	trades: (mode: ViewMode) => ["trades", mode] as const,
	paperStats: ["paper-stats"] as const,
	liveStats: ["live-stats"] as const,
};
