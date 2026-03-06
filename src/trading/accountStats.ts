import { LIVE_INITIAL_BALANCE, PAPER_INITIAL_BALANCE } from "../core/config.ts";
import { AccountStatsManager } from "./accountService.ts";
import type { AccountMode } from "./accountTypes.ts";

export { AccountStatsManager } from "./accountService.ts";
export type { AccountStatsResult, MarketBreakdown, PersistedAccountState, TradeEntry } from "./accountTypes.ts";

export const paperAccount = new AccountStatsManager("paper", PAPER_INITIAL_BALANCE);
export const liveAccount = new AccountStatsManager("live", LIVE_INITIAL_BALANCE);

export async function initAccountStats(): Promise<void> {
	await paperAccount.init();
	await liveAccount.init();
}

export function getAccount(mode: AccountMode): AccountStatsManager {
	return mode === "paper" ? paperAccount : liveAccount;
}
