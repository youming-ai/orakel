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

function regimeMultiplier(
  regime: Regime | null | undefined,
  side: Side,
  multipliers: StrategyConfig["regimeMultipliers"] | null | undefined
): number {
  if (!regime || !multipliers) return 1;
  if (regime === "CHOP") return Number(multipliers.CHOP ?? 1.5);
  if (regime === "RANGE") return Number(multipliers.RANGE ?? 1.0);

  const trendUp = regime === "TREND_UP";
  const trendDown = regime === "TREND_DOWN";
  if (trendUp || trendDown) {
    const aligned = (trendUp && side === "UP") || (trendDown && side === "DOWN");
    return aligned
      ? Number(multipliers.TREND_ALIGNED ?? 0.8)
      : Number(multipliers.TREND_OPPOSED ?? 1.3);
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

  const maxVig = 0.06;
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
}): TradeDecision {
  const {
    remainingMinutes,
    edgeUp,
    edgeDown,
    modelUp = null,
    modelDown = null,
    regime = null,
    strategy
  } = params;

  const phase: Phase = remainingMinutes > 10 ? "EARLY" : remainingMinutes > 5 ? "MID" : "LATE";

  const baseThreshold = phase === "EARLY"
    ? Number(strategy?.edgeThresholdEarly ?? 0.05)
    : phase === "MID"
      ? Number(strategy?.edgeThresholdMid ?? 0.1)
      : Number(strategy?.edgeThresholdLate ?? 0.2);

  const minProb = phase === "EARLY"
    ? Number(strategy?.minProbEarly ?? 0.55)
    : phase === "MID"
      ? Number(strategy?.minProbMid ?? 0.6)
      : Number(strategy?.minProbLate ?? 0.65);

  if (edgeUp === null || edgeDown === null) {
    return { action: "NO_TRADE", side: null, phase, regime, reason: "missing_market_data" };
  }

  const bestSide: Side = edgeUp > edgeDown ? "UP" : "DOWN";
  const bestEdge = bestSide === "UP" ? edgeUp : edgeDown;
  const bestModel = bestSide === "UP" ? modelUp : modelDown;

  const multiplier = regimeMultiplier(regime, bestSide, strategy?.regimeMultipliers);
  const threshold = baseThreshold * multiplier;

  if (bestEdge < threshold) {
    return { action: "NO_TRADE", side: null, phase, regime, reason: `edge_below_${threshold.toFixed(3)}` };
  }

  if (bestModel !== null && bestModel < minProb) {
    return { action: "NO_TRADE", side: null, phase, regime, reason: `prob_below_${minProb}` };
  }

  const strength: Strength = bestEdge >= 0.2 ? "STRONG" : bestEdge >= 0.1 ? "GOOD" : "OPTIONAL";
  return { action: "ENTER", side: bestSide, phase, regime, strength, edge: bestEdge };
}
