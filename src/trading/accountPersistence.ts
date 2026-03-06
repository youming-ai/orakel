import fs from "node:fs";
import { stateQueries, unifiedTradeQueries } from "../db/queries.ts";
import type { AccountMode, PersistedAccountState, TradeEntry } from "./accountTypes.ts";
import type { Side } from "./tradeTypes.ts";

function safeParseJson<T>(raw: string | null | undefined, fallback: T): T {
	if (!raw) return fallback;
	try {
		return JSON.parse(raw) as T;
	} catch {
		return fallback;
	}
}

function getStatsPath(mode: AccountMode): string {
	return mode === "paper" ? "./logs/paper-stats.json" : "./logs/live-stats.json";
}

export function createEmptyAccountState(initialBalance: number): PersistedAccountState {
	return {
		trades: [],
		wins: 0,
		losses: 0,
		totalPnl: 0,
		initialBalance,
		currentBalance: initialBalance,
		maxDrawdown: 0,
		dailyPnl: [],
		dailyCountedTradeIds: [],
		stoppedAt: null,
		stopReason: null,
	};
}

export async function loadAccountState(mode: AccountMode, initialBalance: number): Promise<PersistedAccountState> {
	const stateRow = mode === "paper" ? await stateQueries.getPaperState() : await stateQueries.getLiveState();
	const tradeRows = await unifiedTradeQueries.getAllByMode(mode);

	if (!stateRow) {
		return createEmptyAccountState(initialBalance);
	}

	return {
		trades: tradeRows.map((row) => ({
			id: row.tradeId ?? `legacy-${row.id}`,
			marketId: row.market,
			windowStartMs: row.windowStartMs ?? 0,
			side: row.side as Side,
			price: row.price,
			size: row.amount,
			priceToBeat: row.priceToBeat ?? 0,
			currentPriceAtEntry: row.currentPriceAtEntry,
			timestamp: row.timestamp,
			resolved: Boolean(row.resolved),
			won: row.won === null ? null : Boolean(row.won),
			pnl: row.pnl,
			settlePrice: row.settlePrice,
		})),
		wins: stateRow.wins,
		losses: stateRow.losses,
		totalPnl: stateRow.totalPnl,
		initialBalance: stateRow.initialBalance,
		currentBalance: stateRow.currentBalance,
		maxDrawdown: stateRow.maxDrawdown,
		dailyPnl: safeParseJson(stateRow.dailyPnl, []),
		dailyCountedTradeIds: safeParseJson(stateRow.dailyCountedTradeIds, []),
		stoppedAt: stateRow.stoppedAt,
		stopReason: stateRow.stopReason,
	};
}

export async function saveAccountState(mode: AccountMode, state: PersistedAccountState): Promise<void> {
	const payload = {
		id: 1,
		initialBalance: state.initialBalance,
		currentBalance: state.currentBalance,
		maxDrawdown: state.maxDrawdown,
		wins: state.wins,
		losses: state.losses,
		totalPnl: state.totalPnl,
		stoppedAt: state.stoppedAt,
		stopReason: state.stopReason,
		dailyPnl: JSON.stringify(state.dailyPnl),
		dailyCountedTradeIds: JSON.stringify(state.dailyCountedTradeIds),
	};

	if (mode === "paper") {
		await stateQueries.upsertPaperState(payload);
		return;
	}

	await stateQueries.upsertLiveState(payload);
}

export async function persistTradeEntry(mode: AccountMode, entry: TradeEntry, status?: string): Promise<void> {
	await unifiedTradeQueries.upsert({
		tradeId: entry.id,
		timestamp: entry.timestamp,
		market: entry.marketId,
		side: entry.side,
		amount: entry.size,
		price: entry.price,
		orderId: entry.id,
		status: status ?? (entry.resolved ? (entry.won ? "won" : "lost") : "open"),
		mode,
		windowStartMs: entry.windowStartMs,
		priceToBeat: entry.priceToBeat,
		currentPriceAtEntry: entry.currentPriceAtEntry,
		marketSlug: entry.marketSlug,
		resolved: entry.resolved ? 1 : 0,
		won: entry.won === null ? null : entry.won ? 1 : 0,
		pnl: entry.pnl,
		settlePrice: entry.settlePrice,
	});
}

export function syncAccountTradeLog(mode: AccountMode, state: PersistedAccountState): void {
	const path = getStatsPath(mode);
	fs.mkdirSync("./logs", { recursive: true });
	fs.writeFileSync(path, JSON.stringify(state, null, 2));
}
