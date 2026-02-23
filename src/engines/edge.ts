import type {
  EdgeResult,
  Phase,
  Regime,
  Side,
  StrategyConfig,
  Strength,
  TradeDecision
} from "../types.ts";
import { clamp } from "../utils.ts";

const SOFT_CAP_EDGE = 0.22;
const HARD_CAP_EDGE = 0.30;
/** Sentinel multiplier: any regime multiplier >= this value means "skip trade entirely" */
const REGIME_DISABLED = 999;

// Market-specific performance from backtest
// edgeMultiplier > 1.0 = RAISE threshold (harder to trade) for poor performers
// edgeMultiplier = 1.0 = no adjustment for good performers
const MARKET_PERFORMANCE: Record<string, { winRate: number; edgeMultiplier: number }> = {
  BTC: { winRate: 0.421, edgeMultiplier: 1.3 },   // Worst performer → require 30% more edge
  ETH: { winRate: 0.469, edgeMultiplier: 1.1 },   // Below avg → require 10% more edge
  SOL: { winRate: 0.510, edgeMultiplier: 1.0 },   // Good performer → standard
  XRP: { winRate: 0.542, edgeMultiplier: 1.0 },   // Best performer → standard
};

function regimeMultiplier(
  regime: Regime | null | undefined,
  side: Side,
  multipliers: StrategyConfig["regimeMultipliers"] | null | undefined,
  marketId: string = ""
): number {
  // Skip CHOP completely for underperforming markets
  if (regime === "CHOP") {
    const marketPerf = MARKET_PERFORMANCE[marketId];
    if (marketPerf && marketPerf.winRate < 0.45) {
      return REGIME_DISABLED;
    }
    return Number(multipliers?.CHOP ?? 2.0); // Increased from 1.5 per backtest
  }
  
  if (regime === "RANGE") return Number(multipliers?.RANGE ?? 1.0);

  const trendUp = regime === "TREND_UP";
  const trendDown = regime === "TREND_DOWN";
  if (trendUp || trendDown) {
    const aligned = (trendUp && side === "UP") || (trendDown && side === "DOWN");
    return aligned
      ? Number(multipliers?.TREND_ALIGNED ?? 0.9)
      : Number(multipliers?.TREND_OPPOSED ?? 1.4); // Increased from 1.3
  }

  return 1;
}

export function computeEdge({
  modelUp,
  modelDown,
  marketYes,
  marketNo
}: {
  modelUp: number;
  modelDown: number;
  marketYes: number | null;
  marketNo: number | null;
}): EdgeResult {
  if (marketYes === null || marketNo === null) {
    return {
      marketUp: null,
      marketDown: null,
      edgeUp: null,
      edgeDown: null,
      rawSum: null,
      arbitrage: false,
      overpriced: false
    };
  }

  const rawSum = marketYes + marketNo;
  const arbitrage = rawSum < 0.98;
  const overpriced = rawSum > 1.04;

  const marketUp = clamp(marketYes, 0, 1);
  const marketDown = clamp(marketNo, 0, 1);

  const edgeUp = modelUp - marketUp;
  const edgeDown = modelDown - marketDown;

  const maxVig = 0.03;
  const vigTooHigh = rawSum > (1 + maxVig);

  return {
    marketUp,
    marketDown,
    edgeUp,
    edgeDown,
    rawSum,
    arbitrage,
    overpriced,
    vigTooHigh
  };
}

export function decide(params: {
  remainingMinutes: number;
  edgeUp: number | null;
  edgeDown: number | null;
  modelUp?: number | null;
  modelDown?: number | null;
  regime?: Regime | null;
  modelSource?: string;
  strategy: StrategyConfig;
  marketId?: string;
}): TradeDecision {
  const {
    remainingMinutes,
    edgeUp,
    edgeDown,
    modelUp = null,
    modelDown = null,
    regime = null,
    strategy,
    marketId = ""
  } = params;

  const phase: Phase = remainingMinutes > 10 ? "EARLY" : remainingMinutes > 5 ? "MID" : "LATE";

  // Refined thresholds based on backtest (lowered for better performance)
  const baseThreshold = phase === "EARLY"
    ? Number(strategy?.edgeThresholdEarly ?? 0.05)
    : phase === "MID"
      ? Number(strategy?.edgeThresholdMid ?? 0.08)
      : Number(strategy?.edgeThresholdLate ?? 0.12);

  const minProb = phase === "EARLY"
    ? Number(strategy?.minProbEarly ?? 0.6)
    : phase === "MID"
      ? Number(strategy?.minProbMid ?? 0.65)
      : Number(strategy?.minProbLate ?? 0.72);

  if (edgeUp === null || edgeDown === null) {
    return { action: "NO_TRADE", side: null, phase, regime, reason: "missing_market_data" };
  }

  const bestSide: Side = edgeUp > edgeDown ? "UP" : "DOWN";
  const bestEdge = bestSide === "UP" ? edgeUp : edgeDown;
  const bestModel = bestSide === "UP" ? modelUp : modelDown;
  
  // Apply market-specific edge multiplier (>1.0 raises threshold for poor performers)
  const marketMult = MARKET_PERFORMANCE[marketId]?.edgeMultiplier ?? 1.0;
  const adjustedThreshold = baseThreshold * marketMult;

  const multiplier = regimeMultiplier(regime, bestSide, strategy?.regimeMultipliers, marketId);
  const threshold = adjustedThreshold * multiplier;
  
  // Skip regime entirely when multiplier is the disabled sentinel
  if (multiplier >= REGIME_DISABLED) {
    return { action: "NO_TRADE", side: null, phase, regime, reason: "skip_chop_poor_market" };
  }

  if (bestEdge < threshold) {
    return { action: "NO_TRADE", side: null, phase, regime, reason: `edge_below_${threshold.toFixed(3)}` };
  }

  if (bestModel !== null && bestModel < minProb) {
    return { action: "NO_TRADE", side: null, phase, regime, reason: `prob_below_${minProb}` };
  }
  
  // Overconfidence checks — soft cap BEFORE hard cap so soft can penalize the 0.22-0.30 range
  if (Math.abs(bestEdge) > HARD_CAP_EDGE) {
    return { action: "NO_TRADE", side: null, phase, regime, reason: "overconfident_hard_cap" };
  }
  if (Math.abs(bestEdge) > SOFT_CAP_EDGE) {
    const penalizedThreshold = threshold * 1.4;
    if (bestEdge < penalizedThreshold) {
      return { action: "NO_TRADE", side: null, phase, regime, reason: "overconfident_soft_cap" };
    }
  }

  const strength: Strength = bestEdge >= 0.15 ? "STRONG" : bestEdge >= 0.08 ? "GOOD" : "OPTIONAL";
  return { action: "ENTER", side: bestSide, phase, regime, strength, edge: bestEdge };
}
