import type { QueryClient } from "@tanstack/react-query";
import type { DashboardState } from "@/contracts/http";
import type { WsMessage } from "@/contracts/ws";
import { queryKeys } from "@/shared/query/queryKeys";

export function createWsCacheHandler(qc: QueryClient) {
	return (msg: WsMessage) => {
		switch (msg.type) {
			case "state:snapshot": {
				const prev = qc.getQueryData<DashboardState>(queryKeys.state);
				if (prev) {
					const patch = msg.data;
					qc.setQueryData(queryKeys.state, {
						...prev,
						markets: patch.markets ?? prev.markets,
						updatedAt: patch.updatedAt ?? prev.updatedAt,
						paperRunning: patch.paperRunning ?? prev.paperRunning,
						liveRunning: patch.liveRunning ?? prev.liveRunning,
						paperPendingStart: patch.paperPendingStart ?? prev.paperPendingStart,
						paperPendingStop: patch.paperPendingStop ?? prev.paperPendingStop,
						livePendingStart: patch.livePendingStart ?? prev.livePendingStart,
						livePendingStop: patch.livePendingStop ?? prev.livePendingStop,
						paperPendingSince: patch.paperPendingSince ?? prev.paperPendingSince,
						livePendingSince: patch.livePendingSince ?? prev.livePendingSince,
						paperStats: patch.paperStats ?? prev.paperStats,
						liveStats: patch.liveStats ?? prev.liveStats,
						stopLoss: patch.stopLoss !== undefined ? patch.stopLoss : prev.stopLoss,
						liveStopLoss: patch.liveStopLoss !== undefined ? patch.liveStopLoss : prev.liveStopLoss,
						paperBalance: patch.paperBalance ?? prev.paperBalance,
						liveBalance: patch.liveBalance ?? prev.liveBalance,
						todayStats: patch.todayStats ?? prev.todayStats,
						liveTodayStats: patch.liveTodayStats ?? prev.liveTodayStats,
					});
				}
				break;
			}
			case "trade:executed": {
				qc.invalidateQueries({ queryKey: queryKeys.trades("paper") });
				qc.invalidateQueries({ queryKey: queryKeys.trades("live") });
				qc.invalidateQueries({ queryKey: queryKeys.paperStats });
				qc.invalidateQueries({ queryKey: queryKeys.liveStats });
				break;
			}
			case "balance:snapshot": {
				qc.setQueryData(queryKeys.onchainBalance, msg.data);
				break;
			}
			case "signal:new": {
				qc.invalidateQueries({ queryKey: queryKeys.state });
				break;
			}
		}
	};
}
