import readline from "node:readline";
import type { ProcessMarketResult } from "./index.ts";
import { createLogger } from "./logger.ts";
import { isLiveRunning, isPaperRunning } from "./state.ts";
import type { MacdResult, TradeDecision } from "./types.ts";
import { formatNumber } from "./utils.ts";

const log = createLogger("bot");

interface PanelData {
	id: string;
	lines: string[];
}

interface ANSIMap {
	reset: string;
	red: string;
	green: string;
	gray: string;
	yellow: string;
	white: string;
}

const ANSI: ANSIMap = {
	reset: "\x1b[0m",
	red: "\x1b[31m",
	green: "\x1b[32m",
	gray: "\x1b[90m",
	yellow: "\x1b[33m",
	white: "\x1b[97m",
};

function stripAnsi(s: unknown): string {
	const esc = String.fromCharCode(27);
	return String(s ?? "")
		.replaceAll(esc, "")
		.replace(/\[[0-9;]*m/g, "");
}

function padAnsi(s: unknown, width: number): string {
	const raw = String(s ?? "");
	const len = stripAnsi(raw).length;
	if (len >= width) return raw;
	return raw + " ".repeat(width - len);
}

function screenWidth(): number {
	const w = Number(process.stdout?.columns);
	return Number.isFinite(w) && w >= 80 ? w : 120;
}

function renderScreen(text: string): void {
	try {
		readline.cursorTo(process.stdout, 0, 0);
		readline.clearScreenDown(process.stdout);
	} catch (err) {
		log.debug("renderScreen cursor reset failed:", err);
	}
	process.stdout.write(text);
}

function colorForAction(action: TradeDecision["action"] | undefined, side: TradeDecision["side"] | undefined): string {
	if (action === "ENTER" && side === "UP") return ANSI.green;
	if (action === "ENTER" && side === "DOWN") return ANSI.red;
	return ANSI.gray;
}

function getBtcSession(now: Date = new Date()): string {
	const h = now.getUTCHours();
	const inAsia = h >= 0 && h < 8;
	const inEurope = h >= 7 && h < 16;
	const inUs = h >= 13 && h < 22;
	if (inEurope && inUs) return "Europe/US overlap";
	if (inAsia && inEurope) return "Asia/Europe overlap";
	if (inAsia) return "Asia";
	if (inEurope) return "Europe";
	if (inUs) return "US";
	return "Off-hours";
}

function fmtEtTime(now: Date = new Date()): string {
	try {
		return new Intl.DateTimeFormat("en-US", {
			timeZone: "America/New_York",
			hour: "2-digit",
			minute: "2-digit",
			second: "2-digit",
			hour12: false,
		}).format(now);
	} catch {
		return "-";
	}
}

function fmtTimeLeft(mins: number | null | undefined): string {
	if (!Number.isFinite(Number(mins))) return "--:--";
	const totalSeconds = Math.max(0, Math.floor(Number(mins) * 60));
	const m = Math.floor(totalSeconds / 60);
	const s = totalSeconds % 60;
	return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

function compactMacdLabel(macd: MacdResult | null | undefined): string {
	if (!macd) return "flat";
	if (macd.hist < 0) return macd.histDelta !== null && macd.histDelta < 0 ? "bearish" : "red";
	if (macd.hist > 0) return macd.histDelta !== null && macd.histDelta > 0 ? "bullish" : "green";
	return "flat";
}

function buildPanelData(result: ProcessMarketResult): PanelData {
	if (!result?.ok) {
		return {
			id: result?.market?.id || "-",
			lines: [
				`${ANSI.gray}Predict: --% / --%${ANSI.reset}`,
				`${ANSI.gray}HA: -   RSI: -${ANSI.reset}`,
				`${ANSI.gray}MACD: -   VWAP: -${ANSI.reset}`,
				`${ANSI.gray}⏱ --:--  Price: -${ANSI.reset}`,
				`${ANSI.gray}UP - / DOWN -${ANSI.reset}`,
				`${ANSI.gray}NO DATA${ANSI.reset}`,
			],
		};
	}

	const longColor = result.predictNarrative === "LONG" ? ANSI.green : ANSI.gray;
	const shortColor = result.predictNarrative === "SHORT" ? ANSI.red : ANSI.gray;
	const actionColor = colorForAction(result.rec?.action, result.rec?.side);

	const vwapArrow =
		result.vwapSlope === null || result.vwapSlope === undefined
			? "-"
			: result.vwapSlope > 0
				? "↑"
				: result.vwapSlope < 0
					? "↓"
					: "→";
	const priceDigits = Number(result.market.pricePrecision ?? 2);

	return {
		id: result.market.id,
		lines: [
			`Predict: ${longColor}LONG ${result.pLong ?? "-"}%${ANSI.reset} / ${shortColor}SHORT ${result.pShort ?? "-"}%${ANSI.reset}`,
			`HA: ${result.consec?.color ?? "-"} x${result.consec?.count ?? 0}  RSI: ${formatNumber(result.rsiNow ?? null, 1)}`,
			`MACD: ${compactMacdLabel(result.macd)}  VWAP: ${vwapArrow}`,
			`⏱ ${fmtTimeLeft(result.timeLeftMin)}  Spot: $${formatNumber(result.spotPrice ?? null, priceDigits)}  PTB: ${result.priceToBeat === null || result.priceToBeat === undefined ? "-" : `$${formatNumber(result.priceToBeat, priceDigits)}`}`,
			`UP ${formatNumber(result.marketUp ?? null, 2)}¢ / DOWN ${formatNumber(result.marketDown ?? null, 2)}¢`,
			`${actionColor}${result.actionText ?? "NO TRADE"}${ANSI.reset}`,
		],
	};
}

function headerCell(title: string, width: number): string {
	const label = ` ${title} `;
	const fill = Math.max(0, width - label.length);
	return `─${label}${"─".repeat(fill)}`;
}

function renderGrid(panels: PanelData[]): string {
	const width = screenWidth();
	const cellWidth = Math.max(30, Math.floor((width - 3) / 2));
	const defaultPanel: PanelData = { id: "-", lines: ["", "", "", "", "", ""] };
	const slots: [PanelData, PanelData, PanelData, PanelData] = [
		panels[0] ?? defaultPanel,
		panels[1] ?? defaultPanel,
		panels[2] ?? defaultPanel,
		panels[3] ?? defaultPanel,
	];

	const top = `┌${headerCell(slots[0].id, cellWidth - 1)}┬${headerCell(slots[1].id, cellWidth - 1)}┐`;
	const mid = `├${headerCell(slots[2].id, cellWidth - 1)}┼${headerCell(slots[3].id, cellWidth - 1)}┤`;
	const bot = `└${"─".repeat(cellWidth)}┴${"─".repeat(cellWidth)}┘`;

	const lines: string[] = [top];
	for (let i = 0; i < 6; i += 1) {
		lines.push(`│${padAnsi(slots[0].lines[i] ?? "", cellWidth)}│${padAnsi(slots[1].lines[i] ?? "", cellWidth)}│`);
	}
	lines.push(mid);
	for (let i = 0; i < 6; i += 1) {
		lines.push(`│${padAnsi(slots[2].lines[i] ?? "", cellWidth)}│${padAnsi(slots[3].lines[i] ?? "", cellWidth)}│`);
	}
	lines.push(bot);

	const now = new Date();
	if (isPaperRunning() || isLiveRunning()) {
		const paper = isPaperRunning() ? "ON" : "OFF";
		const live = isLiveRunning() ? "ON" : "OFF";
		lines.push(`${ANSI.yellow}[MODES]${ANSI.reset} PAPER ${paper} | LIVE ${live}`);
	}
	lines.push(
		`${ANSI.white}ET${ANSI.reset} ${fmtEtTime(now)} | ${ANSI.white}Session${ANSI.reset} ${getBtcSession(now)}`,
	);
	return `${lines.join("\n")}\n`;
}

export function renderDashboard(results: ProcessMarketResult[]): void {
	const panelData = results.map((r) => buildPanelData(r));
	renderScreen(renderGrid(panelData));
}
