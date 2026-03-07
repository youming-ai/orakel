import type { DashboardStateDto } from "../../contracts/http.ts";
import type { StateSnapshotPayload } from "../../contracts/stateTypes.ts";
import { CONFIG } from "../../core/config.ts";
import {
	getLivePendingSince,
	getMarkets,
	getPaperPendingSince,
	getUpdatedAt,
	isLivePendingStart,
	isLivePendingStop,
	isLiveRunning,
	isPaperPendingStart,
	isPaperPendingStop,
	isPaperRunning,
} from "../../core/state.ts";
import { liveAccount, paperAccount } from "../../trading/accountStats.ts";
import { getClientStatus, getWalletAddress } from "../../trading/trader.ts";

export function buildStateSnapshotPayload(): StateSnapshotPayload {
	return {
		markets: getMarkets(),
		updatedAt: getUpdatedAt(),
		paperRunning: isPaperRunning(),
		liveRunning: isLiveRunning(),
		paperPendingStart: isPaperPendingStart(),
		paperPendingStop: isPaperPendingStop(),
		livePendingStart: isLivePendingStart(),
		livePendingStop: isLivePendingStop(),
		paperPendingSince: getPaperPendingSince(),
		livePendingSince: getLivePendingSince(),
		paperStats: paperAccount.getStats(),
		liveStats: liveAccount.getStats(),
		liveTodayStats: liveAccount.getTodayStats(),
		paperBalance: paperAccount.getBalance(),
		liveBalance: liveAccount.getBalance(),
		todayStats: paperAccount.getTodayStats(),
		stopLoss: paperAccount.isStopped() ? paperAccount.getStopReason() : null,
		liveStopLoss: liveAccount.isStopped() ? liveAccount.getStopReason() : null,
	};
}

export function buildDashboardStateDto(): DashboardStateDto {
	const snapshot = buildStateSnapshotPayload();
	const walletAddress = getWalletAddress();
	const clientStatus = getClientStatus();
	const paperTodayStats = paperAccount.getTodayStats();
	const liveTodayStats = liveAccount.getTodayStats();

	return {
		...snapshot,
		paperMode: CONFIG.paperMode !== false,
		wallet: { address: walletAddress, connected: !!walletAddress },
		paperDaily: { date: new Date().toDateString(), pnl: paperTodayStats.pnl, trades: paperTodayStats.trades },
		liveDaily: { date: new Date().toDateString(), pnl: liveTodayStats.pnl, trades: liveTodayStats.trades },
		config: {
			strategy: { ...CONFIG.strategy },
			paperRisk: CONFIG.paperRisk,
			liveRisk: CONFIG.liveRisk,
		},
		liveWallet: {
			address: walletAddress,
			connected: clientStatus.walletLoaded,
			clientReady: clientStatus.clientReady,
		},
		paperBalance: snapshot.paperBalance ?? paperAccount.getBalance(),
		liveBalance: snapshot.liveBalance ?? liveAccount.getBalance(),
		todayStats: snapshot.todayStats ?? paperTodayStats,
		liveTodayStats: snapshot.liveTodayStats ?? liveTodayStats,
		stopLoss: snapshot.stopLoss ?? null,
		liveStopLoss: snapshot.liveStopLoss ?? null,
	};
}
