import fs from "node:fs";

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

// Load paper trades
function loadPaperTrades(): PaperTradeEntry[] {
  const statsPath = "./logs/paper-stats.json";
  if (!fs.existsSync(statsPath)) {
    console.error("No paper-stats.json found");
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
  
  return lines.map(line => {
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

// Match trades to signals
function analyzeTrade(trade: PaperTradeEntry, signals: SignalEntry[]): TradeAnalysis {
  const tradeTime = new Date(trade.timestamp).getTime();
  const windowStart = trade.windowStartMs;
  
  // Find signals within same window
  const matchedSignals = signals.filter(s => {
    const signalTime = new Date(s.timestamp).getTime();
    return signalTime >= windowStart && signalTime <= tradeTime;
  });
  
  // Find closest signal to entry
  const entrySignal = matchedSignals.length > 0 
    ? matchedSignals.reduce((closest, s) => {
        const sTime = new Date(s.timestamp).getTime();
        const closestTime = new Date(closest.timestamp).getTime();
        return Math.abs(sTime - tradeTime) < Math.abs(closestTime - tradeTime) ? s : closest;
      })
    : null;
  
  const correctDirection = trade.resolved && trade.settlePrice
    ? (trade.side === "UP" && trade.settlePrice > trade.priceToBeat) || 
      (trade.side === "DOWN" && trade.settlePrice < trade.priceToBeat)
    : null;
  
  const priceChange = trade.resolved && trade.currentPriceAtEntry && trade.settlePrice
    ? ((trade.settlePrice - trade.currentPriceAtEntry) / trade.currentPriceAtEntry) * 100
    : 0;
  
  // Find best/worst entry times
  const winningSignals = matchedSignals.filter(s => {
    if (trade.side === "UP") {
      return s.priceToBeat < (trade.settlePrice || 0);
    } else {
      return s.priceToBeat > (trade.settlePrice || 0);
    }
  });
  
  const bestEntryTime = winningSignals.length > 0
    ? winningSignals.reduce((best, s) => s.edgeUp > best.edgeUp ? s : best).timestamp
    : null;
    
  const losingSignals = matchedSignals.filter(s => {
    if (trade.side === "UP") {
      return s.priceToBeat >= (trade.settlePrice || 0);
    } else {
      return s.priceToBeat <= (trade.settlePrice || 0);
    }
  });
  
  const worstEntryTime = losingSignals.length > 0
    ? losingSignals.reduce((worst, s) => s.edgeUp < worst.edgeUp ? s : worst).timestamp
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
    }
  };
}

// Identify strategy weaknesses
function identifyWeaknesses(analyses: TradeAnalysis[]): StrategyWeakness[] {
  const losingTrades = analyses.filter(a => a.trade.resolved && a.trade.won === false);
  
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
        suggestion: `Consider avoiding trades during ${regime} regime or adjust thresholds`
      });
    }
  }
  
  // 2. Analyze by time left
  const earlyTrades = losingTrades.filter(a => (a.analysis.timeLeftAtEntry || 15) > 10);
  const lateTrades = losingTrades.filter(a => (a.analysis.timeLeftAtEntry || 15) <= 5);
  
  if (earlyTrades.length > 5) {
    weaknesses.push({
      pattern: "Early entry (t > 10 min)",
      count: earlyTrades.length,
      winRate: 0,
      avgPnl: earlyTrades.reduce((s, t) => s + (t.trade.pnl || 0), 0) / earlyTrades.length,
      suggestion: "Consider waiting for more price action before entering early"
    });
  }
  
  if (lateTrades.length > 5) {
    weaknesses.push({
      pattern: "Late entry (t <= 5 min)",
      count: lateTrades.length,
      winRate: 0,
      avgPnl: lateTrades.reduce((s, t) => s + (t.trade.pnl || 0), 0) / lateTrades.length,
      suggestion: "Late entries may lack time for edge to materialize"
    });
  }
  
  // 3. Analyze by edge size
  const lowEdge = losingTrades.filter(a => {
    const edge = Math.max(a.analysis.edgeAtEntry || 0, - (a.analysis.edgeAtEntry || 0));
    return edge < 0.1;
  });
  
  if (lowEdge.length > 5) {
    weaknesses.push({
      pattern: "Low edge entries (< 10%)",
      count: lowEdge.length,
      winRate: 0,
      avgPnl: lowEdge.reduce((s, t) => s + (t.trade.pnl || 0), 0) / lowEdge.length,
      suggestion: "Increase minimum edge threshold from 5% to 10-15%"
    });
  }
  
  // 4. Analyze by volatility
  const highVol = losingTrades.filter(a => {
    const vol = a.analysis.volatilityAtEntry || 0;
    return vol > 0.003; // High volatility threshold
  });
  
  if (highVol.length > 5) {
    weaknesses.push({
      pattern: "High volatility (> 0.3% 15m vol)",
      count: highVol.length,
      winRate: 0,
      avgPnl: highVol.reduce((s, t) => s + (t.trade.pnl || 0), 0) / highVol.length,
      suggestion: "Consider reducing position size or avoiding high volatility periods"
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
        suggestion: `Review ${market} model accuracy - consider market-specific adjustments`
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
        suggestion: `${side} model may be biased - check data sources and model weights`
      });
    }
  }
  
  return weaknesses;
}

// Generate strategy recommendations
function generateRecommendations(weaknesses: StrategyWeakness[], analyses: TradeAnalysis[]): string[] {
  const recommendations: string[] = [];
  
  for (const w of weaknesses) {
    recommendations.push(`[${w.pattern}: ${(w.winRate * 100).toFixed(1)}% WR, avg PnL ${w.avgPnl.toFixed(2)}] -> ${w.suggestion}`);
  }
  
  // Add general recommendations
  const resolvedTrades = analyses.filter(a => a.trade.resolved);
  const totalResolved = resolvedTrades.length;
  
  if (totalResolved > 0) {
    const avgHoldTime = resolvedTrades.reduce((s, a) => s + (15 - (a.analysis.timeLeftAtEntry || 15)), 0) / totalResolved;
    if (avgHoldTime < 5) {
      recommendations.push(`[Timing: avg entry at ${(15 - avgHoldTime).toFixed(1)} min] -> Consider entering earlier in window for better prices`);
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
  console.log("╔════════════════════════════════════════════════════════════╗");
  console.log("║          PAPER ACCOUNT BACKTEST ANALYSIS                   ║");
  console.log("╚════════════════════════════════════════════════════════════╝\n");
  
  // Load trades
  const trades = loadPaperTrades();
  const resolvedTrades = trades.filter(t => t.resolved);
  const pendingTrades = trades.filter(t => !t.resolved);
  
  console.log(`📊 Total Trades: ${trades.length}`);
  console.log(`✅ Resolved: ${resolvedTrades.length}`);
  console.log(`⏳ Pending: ${pendingTrades.length}\n`);
  
  if (resolvedTrades.length === 0) {
    console.log("No resolved trades to analyze.");
    return;
  }
  
  // Performance Summary
  const wins = resolvedTrades.filter(t => t.won).length;
  const losses = resolvedTrades.filter(t => !t.won).length;
  const totalPnl = resolvedTrades.reduce((s, t) => s + (t.pnl || 0), 0);
  const avgWin = wins > 0 ? resolvedTrades.filter(t => t.won).reduce((s, t) => s + (t.pnl || 0), 0) / wins : 0;
  const avgLoss = losses > 0 ? resolvedTrades.filter(t => !t.won).reduce((s, t) => s + (t.pnl || 0), 0) / losses : 0;
  
  console.log("📈 PERFORMANCE SUMMARY");
  console.log("─".repeat(50));
  console.log(`Win Rate:        ${(wins / resolvedTrades.length * 100).toFixed(1)}% (${wins}/${resolvedTrades.length})`);
  console.log(`Total PnL:       $${totalPnl.toFixed(2)}`);
  console.log(`Average Win:     $${avgWin.toFixed(2)}`);
  console.log(`Average Loss:    $${avgLoss.toFixed(2)}`);
  console.log(`Profit Factor:   ${(Math.abs(avgWin * wins) / Math.abs(avgLoss * losses)).toFixed(2)}`);
  console.log();
  
  // Market breakdown
  console.log("📊 MARKET BREAKDOWN");
  console.log("─".repeat(50));
  const markets = ["BTC", "ETH", "SOL", "XRP"];
  for (const market of markets) {
    const mTrades = resolvedTrades.filter(t => t.marketId === market);
    const mWins = mTrades.filter(t => t.won).length;
    const mLosses = mTrades.filter(t => !t.won).length;
    const mPnl = mTrades.reduce((s, t) => s + (t.pnl || 0), 0);
    if (mTrades.length > 0) {
      const wr = mWins / (mWins + mLosses) * 100;
      const status = wr >= 50 ? "✅" : wr >= 40 ? "⚠️" : "❌";
      console.log(`${market}: ${status} ${wr.toFixed(1)}% WR, $${mPnl.toFixed(2)} (${mWins}/${mWins + mLosses})`);
    }
  }
  console.log();
  
  // Load signals and analyze
  console.log("🔍 ANALYZING TRADES...\n");
  const analyses: TradeAnalysis[] = [];
  
  for (const trade of resolvedTrades) {
    const signals = parseSignalsCsv(`./logs/signals-${trade.marketId}.csv`);
    const analysis = analyzeTrade(trade, signals);
    analyses.push(analysis);
  }
  
  // Identify weaknesses
  console.log("⚠️  STRATEGY WEAKNESSES IDENTIFIED");
  console.log("─".repeat(50));
  const weaknesses = identifyWeaknesses(analyses);
  if (weaknesses.length === 0) {
    console.log("No significant weaknesses identified.");
  } else {
    for (const w of weaknesses) {
      console.log(`\n• ${w.pattern}`);
      console.log(`  Count: ${w.count} | Win Rate: ${(w.winRate * 100).toFixed(1)}% | Avg PnL: $${w.avgPnl.toFixed(2)}`);
      console.log(`  → ${w.suggestion}`);
    }
  }
  console.log();
  
  // Generate recommendations
  console.log("💡 STRATEGY RECOMMENDATIONS");
  console.log("─".repeat(50));
  const recommendations = generateRecommendations(weaknesses, analyses);
  for (const rec of recommendations) {
    console.log(`• ${rec}`);
  }
  console.log();
  
  // Entry timing analysis
  console.log("⏰ ENTRY TIMING ANALYSIS");
  console.log("─".repeat(50));
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
      const wr = stats.wins / total * 100;
      console.log(`${bucket}: ${wr.toFixed(1)}% WR (${stats.wins}/${total})`);
    }
  }
  console.log();
  
  // Edge analysis
  console.log("📐 EDGE ANALYSIS");
  console.log("─".repeat(50));
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
      const wr = stats.wins / total * 100;
      console.log(`${bucket}: ${wr.toFixed(1)}% WR (${stats.wins}/${total})`);
    }
  }
  console.log();
  
  // Save detailed analysis
  const outputPath = "./logs/backtest-analysis.json";
  fs.writeFileSync(outputPath, JSON.stringify({
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
      profitFactor: Math.abs(avgWin * wins) / Math.abs(avgLoss * losses)
    },
    weaknesses,
    recommendations,
    tradeAnalyses: analyses.map(a => ({
      marketId: a.trade.marketId,
      timestamp: a.trade.timestamp,
      side: a.trade.side,
      won: a.trade.won,
      pnl: a.trade.pnl,
      edgeAtEntry: a.analysis.edgeAtEntry,
      regimeAtEntry: a.analysis.regimeAtEntry,
      timeLeftAtEntry: a.analysis.timeLeftAtEntry,
      volatilityAtEntry: a.analysis.volatilityAtEntry,
    }))
  }, null, 2));
  
  console.log(`📁 Detailed analysis saved to: ${outputPath}`);
  console.log(`\n${"=".repeat(50)}`);
  console.log("Backtest complete!");
}

// Run if called directly
if (import.meta.main) {
  runBacktest();
}
