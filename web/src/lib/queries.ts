import { useDashboardStateWithWs } from "@/app/ws/useDashboardStateWithWs";
import { useLiveStats, usePaperStats } from "@/entities/account/queries";
import { useTrades } from "@/entities/trade/queries";
import {
	useLiveCancel,
	useLiveReset,
	useLiveToggle,
	usePaperCancel,
	usePaperClearStop,
	usePaperReset,
	usePaperToggle,
} from "@/features/botControl/mutations";

export {
	useDashboardStateWithWs,
	useLiveCancel,
	useLiveReset,
	useLiveStats,
	useLiveToggle,
	usePaperCancel,
	usePaperClearStop,
	usePaperReset,
	usePaperStats,
	usePaperToggle,
	useTrades,
};
