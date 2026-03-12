import { useDashboardStateWithWs } from "@/app/ws/useDashboardStateWithWs";
import { useLiveStats, usePaperStats } from "@/entities/account/queries";
import { useTrades } from "@/entities/trade/queries";
import { useLiveCancel, useLiveToggle, usePaperCancel, usePaperToggle } from "@/features/botControl/mutations";

export {
	useDashboardStateWithWs,
	useLiveCancel,
	useLiveStats,
	useLiveToggle,
	usePaperCancel,
	usePaperStats,
	usePaperToggle,
	useTrades,
};
