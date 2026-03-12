import type { StateSnapshotPayload } from "@orakel/shared/contracts";
import type { QueryClient } from "@tanstack/react-query";
import type { DashboardState } from "@/contracts/http";
import type { WsMessage } from "@/contracts/ws";
import { mapStateSnapshotToDashboardPatch } from "@/lib/mappers";
import { queryKeys } from "@/shared/query/queryKeys";

export function createWsCacheHandler(qc: QueryClient) {
	return (msg: WsMessage) => {
		switch (msg.type) {
			case "state:snapshot": {
				const prev = qc.getQueryData<DashboardState>(queryKeys.state);
				if (prev) {
					const patch = mapStateSnapshotToDashboardPatch(msg.data as StateSnapshotPayload);
					qc.setQueryData(queryKeys.state, {
						...prev,
						...patch,
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
