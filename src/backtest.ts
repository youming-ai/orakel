import fs from "node:fs";
import { statements } from "./db.ts";
import { createLogger } from "./logger.ts";

const log = createLogger("backtest");

interface PaperTradeEntry {
	id: string;
	marketId: string;
	windowStartMs: number;
	side: "UP" | "DOWN";
	price: number;
	size: number;
	priceToBeat: number;
	currentPriceAtEntry: number | null;
	timestamp: string;
	resolved: boolean;
	won: boolean | null;
	pnl: number | null;
	settlePrice: number | null;
}

interface SignalEntry {
	timestamp: string;
	entryMinute: number;
	timeLeftMin: number;
	regime: string;
	signal: string;
	volImpliedUp: number | null;
	taRawUp: number;
	blendedUp: number;
	blendSource: string;
	volatility15m: number;
	priceToBeat: number;
	binanceChainlinkDelta: number;
	orderbookImbalance: number;
	modelUp: number;
	modelDown: number;
	mktUp: number;
	mktDown: number;
	rawSum: number;
	arbitrage: boolean;
	edgeUp: number;
	edgeDown: number;
	recommendation: string;
}

interface TradeAnalysis {
	trade: PaperTradeEntry;
	matchedSignals: SignalEntry[];
	entrySignal: SignalEntry | null;
	analysis: {
		wasCorrectDirection: boolean;
		priceChange: number;
		bestEntryTime: string | null;
		worstEntryTime: string | null;
		edgeAtEntry: number | null;
		regimeAtEntry: string | null;
		volatilityAtEntry: number | null;
		timeLeftAtEntry: number | null;
		recommendationAtEntry: string | null;
	};
}

interface StrategyWeakness {
	pattern: string;
	count: number;
	winRate: number;
	avgPnl: number;
	suggestion: string;
}

// Load paper trades (SQLite first, JSON fallback)
function loadPaperTrades(): PaperTradeEntry[] {
	try {
		const rows = statements.getAllPaperTrades().all() as Array<Record<string, unknown>>;
		if (rows.length > 0) {
			return rows.map((r) => ({
				id: String(r.id),
				marketId: String(r.market_id),
				windowStartMs: Number(r.window_start_ms),
				side: String(r.side) as "UP" | "DOWN",
				price: Number(r.price),
				size: Number(r.size),
				priceToBeat: Number(r.price_to_beat),
				currentPriceAtEntry: r.current_price_at_entry === null ? null : Number(r.current_price_at_entry),
				timestamp: String(r.timestamp),
				resolved: Boolean(r.resolved),
				won: r.won === null ? null : Boolean(r.won),
				pnl: r.pnl === null ? null : Number(r.pnl),
				settlePrice: r.settle_price === null ? null : Number(r.settle_price),
			}));
		}
	} catch (err) {
		log.warn("Failed to load paper trades from SQLite:", err);
	}

	// Fallback: JSON
	const statsPath = "./logs/paper-stats.json";
	if (!fs.existsSync(statsPath)) {
		log.error("No paper trades found in SQLite or paper-stats.json");
		return [];
	}
	const data = JSON.parse(fs.readFileSync(statsPath, "utf8"));
	return data.trades || [];
}

// Parse signals CSV
function parseSignalsCsv(filePath: string): SignalEntry[] {
	if (!fs.existsSync(filePath)) return [];
	const content = fs.readFileSync(filePath, "utf8");
	const lines = content.trim().split("\n");

	return lines.map((line) => {
		const cols = line.split(",");
		const col = (idx: number): string => cols[idx] ?? "";
		return {
			timestamp: col(0),
			entryMinute: parseFloat(col(1)) || 0,
			timeLeftMin: parseFloat(col(2)) || 0,
			regime: col(3),
			signal: col(4),
			volImpliedUp: col(5) ? parseFloat(col(5)) : null,
			taRawUp: parseFloat(col(6)) || 0,
			blendedUp: parseFloat(col(7)) || 0,
			blendSource: col(8),
			volatility15m: parseFloat(col(9)) || 0,
			priceToBeat: parseFloat(col(10)) || 0,
			binanceChainlinkDelta: parseFloat(col(11)) || 0,
			orderbookImbalance: parseFloat(col(12)) || 0,
			modelUp: parseFloat(col(13)) || 0,
			modelDown: parseFloat(col(14)) || 0,
			mktUp: parseFloat(col(15)) || 0,
			mktDown: parseFloat(col(16)) || 0,
			rawSum: parseFloat(col(17)) || 0,
			arbitrage: col(18) === "true",
			edgeUp: parseFloat(col(19)) || 0,
			edgeDown: parseFloat(col(20)) || 0,
			recommendation: col(21),
		};
	});
}

// Load signals from SQLite (with CSV fallback)
function loadSignalsForMarket(marketId: string): SignalEntry[] {
	try {
		const rows = statements.getRecentSignals().all({ $limit: 10000 }) as Array<Record<string, unknown>>;
		const filtered = rows.filter((r) => r.market === marketId);
		if (filtered.length > 0) {
			return filtered.map((r) => ({
				timestamp: String(r.timestamp ?? ""),
				entryMinute: Number(r.entry_minute ?? 0),
				timeLeftMin: Number(r.time_left_min ?? 0),
				regime: String(r.regime ?? ""),
				signal: String(r.signal ?? ""),
				volImpliedUp: r.vol_implied_up === null ? null : Number(r.vol_implied_up),
				taRawUp: Number(r.ta_raw_up ?? 0),
				blendedUp: Number(r.blended_up ?? 0),
				blendSource: String(r.blend_source ?? ""),
				volatility15m: Number(r.volatility_15m ?? 0),
				priceToBeat: Number(r.price_to_beat ?? 0),
				binanceChainlinkDelta: Number(r.binance_chainlink_delta ?? 0),
				orderbookImbalance: Number(r.orderbook_imbalance ?? 0),
				modelUp: Number(r.model_up ?? 0),
				modelDown: Number(r.model_down ?? 0),
				mktUp: Number(r.mkt_up ?? 0),
				mktDown: Number(r.mkt_down ?? 0),
				rawSum: Number(r.raw_sum ?? 0),
				arbitrage: Boolean(r.arbitrage),
				edgeUp: Number(r.edge_up ?? 0),
				edgeDown: Number(r.edge_down ?? 0),
				recommendation: String(r.recommendation ?? ""),
			}));
		}
	} catch (err) {
		log.warn("Failed to load signals from SQLite:", err);
	}

	// Fallback: CSV
	return parseSignalsCsv(`./data/signals-${marketId}.csv`);
}

// Match trades to signals
function analyzeTrade(trade: PaperTradeEntry, signals: SignalEntry[]): TradeAnalysis {
	const tradeTime = new Date(trade.timestamp).getTime();
	const windowStart = trade.windowStartMs;

	// Find signals within same window
	const matchedSignals = signals.filter((s) => {
		const signalTime = new Date(s.timestamp).getTime();
		return signalTime >= windowStart && signalTime <= tradeTime;
	});

	// Find closest signal to entry
	const entrySignal =
		matchedSignals.length > 0
			? matchedSignals.reduce((closest, s) => {
					const sTime = new Date(s.timestamp).getTime();
					const closestTime = new Date(closest.timestamp).getTime();
					return Math.abs(sTime - tradeTime) < Math.abs(closestTime - tradeTime) ? s : closest;
				})
			: null;

	const correctDirection =
		trade.resolved && trade.settlePrice
			? (trade.side === "UP" && trade.settlePrice > trade.priceToBeat) ||
				(trade.side === "DOWN" && trade.settlePrice < trade.priceToBeat)
			: null;

	const priceChange =
		trade.resolved && trade.currentPriceAtEntry && trade.settlePrice
			? ((trade.settlePrice - trade.currentPriceAtEntry) / trade.currentPriceAtEntry) * 100
			: 0;

	// Find best/worst entry times
	const winningSignals = matchedSignals.filter((s) => {
		if (trade.side === "UP") {
			return s.priceToBeat < (trade.settlePrice || 0);
		} else {
			return s.priceToBeat > (trade.settlePrice || 0);
		}
	});

	const bestEntryTime =
		winningSignals.length > 0
			? winningSignals.reduce((best, s) => (s.edgeUp > best.edgeUp ? s : best)).timestamp
			: null;

	const losingSignals = matchedSignals.filter((s) => {
		if (trade.side === "UP") {
			return s.priceToBeat >= (trade.settlePrice || 0);
		} else {
			return s.priceToBeat <= (trade.settlePrice || 0);
		}
	});

	const worstEntryTime =
		losingSignals.length > 0
			? losingSignals.reduce((worst, s) => (s.edgeUp < worst.edgeUp ? s : worst)).timestamp
			: null;

	return {
		trade,
		matchedSignals,
		entrySignal,
		analysis: {
			wasCorrectDirection: correctDirection || false,
			priceChange,
			bestEntryTime,
			worstEntryTime,
			edgeAtEntry: entrySignal ? (trade.side === "UP" ? entrySignal.edgeUp : entrySignal.edgeDown) : null,
			regimeAtEntry: entrySignal?.regime || null,
			volatilityAtEntry: entrySignal?.volatility15m || null,
			timeLeftAtEntry: entrySignal?.timeLeftMin || null,
			recommendationAtEntry: entrySignal?.recommendation || null,
		},
	};
}

// Identify strategy weaknesses
function identifyWeaknesses(analyses: TradeAnalysis[]): StrategyWeakness[] {
	const losingTrades = analyses.filter((a) => a.trade.resolved && a.trade.won === false);

	const weaknesses: StrategyWeakness[] = [];

	// 1. Analyze by regime
	const regimeStats: Record<string, { wins: number; losses: number; pnl: number }> = {};
	for (const a of analyses) {
		if (!a.analysis.regimeAtEntry) continue;
		const regime = a.analysis.regimeAtEntry;
		if (!regimeStats[regime]) regimeStats[regime] = { wins: 0, losses: 0, pnl: 0 };
		if (a.trade.won) {
			regimeStats[regime].wins++;
			regimeStats[regime].pnl += a.trade.pnl || 0;
		} else if (a.trade.won === false) {
			regimeStats[regime].losses++;
			regimeStats[regime].pnl += a.trade.pnl || 0;
		}
	}

	for (const [regime, stats] of Object.entries(regimeStats)) {
		const total = stats.wins + stats.losses;
		if (total >= 3 && stats.wins / total < 0.45) {
			weaknesses.push({
				pattern: `${regime} regime trades`,
				count: total,
				winRate: stats.wins / total,
				avgPnl: stats.pnl / total,
				suggestion: `Consider avoiding trades during ${regime} regime or adjust thresholds`,
			});
		}
	}

	// 2. Analyze by time left
	const earlyTrades = losingTrades.filter((a) => (a.analysis.timeLeftAtEntry || 15) > 10);
	const lateTrades = losingTrades.filter((a) => (a.analysis.timeLeftAtEntry || 15) <= 5);

	if (earlyTrades.length > 5) {
		weaknesses.push({
			pattern: "Early entry (t > 10 min)",
			count: earlyTrades.length,
			winRate: 0,
			avgPnl: earlyTrades.reduce((s, t) => s + (t.trade.pnl || 0), 0) / earlyTrades.length,
			suggestion: "Consider waiting for more price action before entering early",
		});
	}

	if (lateTrades.length > 5) {
		weaknesses.push({
			pattern: "Late entry (t <= 5 min)",
			count: lateTrades.length,
			winRate: 0,
			avgPnl: lateTrades.reduce((s, t) => s + (t.trade.pnl || 0), 0) / lateTrades.length,
			suggestion: "Late entries may lack time for edge to materialize",
		});
	}

	// 3. Analyze by edge size
	const lowEdge = losingTrades.filter((a) => {
		const edge = Math.max(a.analysis.edgeAtEntry || 0, -(a.analysis.edgeAtEntry || 0));
		return edge < 0.1;
	});

	if (lowEdge.length > 5) {
		weaknesses.push({
			pattern: "Low edge entries (< 10%)",
			count: lowEdge.length,
			winRate: 0,
			avgPnl: lowEdge.reduce((s, t) => s + (t.trade.pnl || 0), 0) / lowEdge.length,
			suggestion: "Increase minimum edge threshold from 5% to 10-15%",
		});
	}

	// 4. Analyze by volatility
	const highVol = losingTrades.filter((a) => {
		const vol = a.analysis.volatilityAtEntry || 0;
		return vol > 0.003; // High volatility threshold
	});

	if (highVol.length > 5) {
		weaknesses.push({
			pattern: "High volatility (> 0.3% 15m vol)",
			count: highVol.length,
			winRate: 0,
			avgPnl: highVol.reduce((s, t) => s + (t.trade.pnl || 0), 0) / highVol.length,
			suggestion: "Consider reducing position size or avoiding high volatility periods",
		});
	}

	// 5. Analyze by market
	const marketStats: Record<string, { wins: number; losses: number; pnl: number }> = {};
	for (const a of analyses) {
		const market = a.trade.marketId;
		if (!marketStats[market]) marketStats[market] = { wins: 0, losses: 0, pnl: 0 };
		if (a.trade.won) {
			marketStats[market].wins++;
			marketStats[market].pnl += a.trade.pnl || 0;
		} else if (a.trade.won === false) {
			marketStats[market].losses++;
			marketStats[market].pnl += a.trade.pnl || 0;
		}
	}

	for (const [market, stats] of Object.entries(marketStats)) {
		const total = stats.wins + stats.losses;
		if (total >= 5 && stats.wins / total < 0.4) {
			weaknesses.push({
				pattern: `${market} market trades`,
				count: total,
				winRate: stats.wins / total,
				avgPnl: stats.pnl / total,
				suggestion: `Review ${market} model accuracy - consider market-specific adjustments`,
			});
		}
	}

	// 6. Analyze by side
	const sideStats: Record<string, { wins: number; losses: number; pnl: number }> = {};
	for (const a of analyses) {
		const side = a.trade.side;
		if (!sideStats[side]) sideStats[side] = { wins: 0, losses: 0, pnl: 0 };
		if (a.trade.won) {
			sideStats[side].wins++;
			sideStats[side].pnl += a.trade.pnl || 0;
		} else if (a.trade.won === false) {
			sideStats[side].losses++;
			sideStats[side].pnl += a.trade.pnl || 0;
		}
	}

	for (const [side, stats] of Object.entries(sideStats)) {
		const total = stats.wins + stats.losses;
		if (total >= 5 && stats.wins / total < 0.4) {
			weaknesses.push({
				pattern: `${side} side trades`,
				count: total,
				winRate: stats.wins / total,
				avgPnl: stats.pnl / total,
				suggestion: `${side} model may be biased - check data sources and model weights`,
			});
		}
	}

	return weaknesses;
}

// Generate strategy recommendations
function generateRecommendations(weaknesses: StrategyWeakness[], analyses: TradeAnalysis[]): string[] {
	const recommendations: string[] = [];

	for (const w of weaknesses) {
		recommendations.push(
			`[${w.pattern}: ${(w.winRate * 100).toFixed(1)}% WR, avg PnL ${w.avgPnl.toFixed(2)}] -> ${w.suggestion}`,
		);
	}

	// Add general recommendations
	const resolvedTrades = analyses.filter((a) => a.trade.resolved);
	const totalResolved = resolvedTrades.length;

	if (totalResolved > 0) {
		const avgHoldTime =
			resolvedTrades.reduce((s, a) => s + (15 - (a.analysis.timeLeftAtEntry || 15)), 0) / totalResolved;
		if (avgHoldTime < 5) {
			recommendations.push(
				`[Timing: avg entry at ${(15 - avgHoldTime).toFixed(1)} min] -> Consider entering earlier in window for better prices`,
			);
		}

		const avgEdge = resolvedTrades.reduce((s, a) => s + (a.analysis.edgeAtEntry || 0), 0) / totalResolved;
		if (avgEdge < 0.1) {
			recommendations.push(`[Edge: avg ${(avgEdge * 100).toFixed(1)}%] -> Increase minimum edge threshold to 10-15%`);
		}
	}

	return recommendations;
}

// Main backtest function
export function runBacktest(): void {
	log.info("╔════════════════════════════════════════════════════════════╗");
	log.info("║          PAPER ACCOUNT BACKTEST ANALYSIS                   ║");
	log.info("╚════════════════════════════════════════════════════════════╝\n");

	// Load trades
	const trades = loadPaperTrades();
	const resolvedTrades = trades.filter((t) => t.resolved);
	const pendingTrades = trades.filter((t) => !t.resolved);

	log.info(`📊 Total Trades: ${trades.length}`);
	log.info(`✅ Resolved: ${resolvedTrades.length}`);
	log.info(`⏳ Pending: ${pendingTrades.length}\n`);

	if (resolvedTrades.length === 0) {
		log.info("No resolved trades to analyze.");
		return;
	}

	// Performance Summary
	const wins = resolvedTrades.filter((t) => t.won).length;
	const losses = resolvedTrades.filter((t) => !t.won).length;
	const totalPnl = resolvedTrades.reduce((s, t) => s + (t.pnl || 0), 0);
	const avgWin = wins > 0 ? resolvedTrades.filter((t) => t.won).reduce((s, t) => s + (t.pnl || 0), 0) / wins : 0;
	const avgLoss = losses > 0 ? resolvedTrades.filter((t) => !t.won).reduce((s, t) => s + (t.pnl || 0), 0) / losses : 0;

	log.info("📈 PERFORMANCE SUMMARY");
	log.info("─".repeat(50));
	log.info(`Win Rate:        ${((wins / resolvedTrades.length) * 100).toFixed(1)}% (${wins}/${resolvedTrades.length})`);
	log.info(`Total PnL:       $${totalPnl.toFixed(2)}`);
	log.info(`Average Win:     $${avgWin.toFixed(2)}`);
	log.info(`Average Loss:    $${avgLoss.toFixed(2)}`);
	log.info(`Profit Factor:   ${(Math.abs(avgWin * wins) / Math.abs(avgLoss * losses)).toFixed(2)}`);
	log.info();

	// Market breakdown
	log.info("📊 MARKET BREAKDOWN");
	log.info("─".repeat(50));
	const markets = ["BTC", "ETH", "SOL", "XRP"];
	for (const market of markets) {
		const mTrades = resolvedTrades.filter((t) => t.marketId === market);
		const mWins = mTrades.filter((t) => t.won).length;
		const mLosses = mTrades.filter((t) => !t.won).length;
		const mPnl = mTrades.reduce((s, t) => s + (t.pnl || 0), 0);
		if (mTrades.length > 0) {
			const wr = (mWins / (mWins + mLosses)) * 100;
			const status = wr >= 50 ? "✅" : wr >= 40 ? "⚠️" : "❌";
			log.info(`${market}: ${status} ${wr.toFixed(1)}% WR, $${mPnl.toFixed(2)} (${mWins}/${mWins + mLosses})`);
		}
	}
	log.info();

	// Load signals and analyze
	log.info("🔍 ANALYZING TRADES...\n");
	const analyses: TradeAnalysis[] = [];

	for (const trade of resolvedTrades) {
		const signals = loadSignalsForMarket(trade.marketId);
		const analysis = analyzeTrade(trade, signals);
		analyses.push(analysis);
	}

	// Identify weaknesses
	log.info("⚠️  STRATEGY WEAKNESSES IDENTIFIED");
	log.info("─".repeat(50));
	const weaknesses = identifyWeaknesses(analyses);
	if (weaknesses.length === 0) {
		log.info("No significant weaknesses identified.");
	} else {
		for (const w of weaknesses) {
			log.info(`\n• ${w.pattern}`);
			log.info(`  Count: ${w.count} | Win Rate: ${(w.winRate * 100).toFixed(1)}% | Avg PnL: $${w.avgPnl.toFixed(2)}`);
			log.info(`  → ${w.suggestion}`);
		}
	}
	log.info();

	// Generate recommendations
	log.info("💡 STRATEGY RECOMMENDATIONS");
	log.info("─".repeat(50));
	const recommendations = generateRecommendations(weaknesses, analyses);
	for (const rec of recommendations) {
		log.info(`• ${rec}`);
	}
	log.info();

	// Entry timing analysis
	log.info("⏰ ENTRY TIMING ANALYSIS");
	log.info("─".repeat(50));
	const timeBuckets: Record<string, { wins: number; losses: number }> = {
		"Early (>10 min)": { wins: 0, losses: 0 },
		"Mid (5-10 min)": { wins: 0, losses: 0 },
		"Late (<=5 min)": { wins: 0, losses: 0 },
	};

	for (const a of analyses) {
		const t = a.analysis.timeLeftAtEntry ?? 15;
		const bucket = t > 10 ? "Early (>10 min)" : t > 5 ? "Mid (5-10 min)" : "Late (<=5 min)";
		const stats = timeBuckets[bucket];
		if (!stats) continue;
		if (a.trade.won) stats.wins++;
		else stats.losses++;
	}

	for (const [bucket, stats] of Object.entries(timeBuckets)) {
		const total = stats.wins + stats.losses;
		if (total > 0) {
			const wr = (stats.wins / total) * 100;
			log.info(`${bucket}: ${wr.toFixed(1)}% WR (${stats.wins}/${total})`);
		}
	}
	log.info();

	// Edge analysis
	log.info("📐 EDGE ANALYSIS");
	log.info("─".repeat(50));
	const edgeBuckets: Record<string, { wins: number; losses: number }> = {
		"Low (< 10%)": { wins: 0, losses: 0 },
		"Medium (10-20%)": { wins: 0, losses: 0 },
		"High (>= 20%)": { wins: 0, losses: 0 },
	};

	for (const a of analyses) {
		const edge = Math.abs(a.analysis.edgeAtEntry ?? 0);
		const bucket = edge < 0.1 ? "Low (< 10%)" : edge < 0.2 ? "Medium (10-20%)" : "High (>= 20%)";
		const stats = edgeBuckets[bucket];
		if (!stats) continue;
		if (a.trade.won) stats.wins++;
		else stats.losses++;
	}

	for (const [bucket, stats] of Object.entries(edgeBuckets)) {
		const total = stats.wins + stats.losses;
		if (total > 0) {
			const wr = (stats.wins / total) * 100;
			log.info(`${bucket}: ${wr.toFixed(1)}% WR (${stats.wins}/${total})`);
		}
	}
	log.info();

	// Save detailed analysis
	const outputPath = "./data/backtest-analysis.json";
	fs.writeFileSync(
		outputPath,
		JSON.stringify(
			{
				summary: {
					totalTrades: trades.length,
					resolved: resolvedTrades.length,
					pending: pendingTrades.length,
					wins,
					losses,
					winRate: wins / resolvedTrades.length,
					totalPnl,
					avgWin,
					avgLoss,
					profitFactor: Math.abs(avgWin * wins) / Math.abs(avgLoss * losses),
				},
				weaknesses,
				recommendations,
				tradeAnalyses: analyses.map((a) => ({
					marketId: a.trade.marketId,
					timestamp: a.trade.timestamp,
					side: a.trade.side,
					won: a.trade.won,
					pnl: a.trade.pnl,
					edgeAtEntry: a.analysis.edgeAtEntry,
					regimeAtEntry: a.analysis.regimeAtEntry,
					timeLeftAtEntry: a.analysis.timeLeftAtEntry,
					volatilityAtEntry: a.analysis.volatilityAtEntry,
				})),
			},
			null,
			2,
		),
	);

	log.info(`📁 Detailed analysis saved to: ${outputPath}`);
	log.info(`\n${"=".repeat(50)}`);
	log.info("Backtest complete!");
}

// Run if called directly
if (import.meta.main) {
	runBacktest();
}
