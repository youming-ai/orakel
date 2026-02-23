export interface Candle {
  openTime: number;
  open: number | null;
  high: number | null;
  low: number | null;
  close: number | null;
  volume: number | null;
  closeTime: number;
}

export interface HaCandle {
  open: number;
  high: number;
  low: number;
  close: number;
  isGreen: boolean;
  body: number;
}

export interface MarketConfig {
  id: string;
  label: string;
  binanceSymbol: string;
  polymarket: {
    seriesId: string;
    seriesSlug: string;
    slugPrefix: string;
  };
  chainlink: {
    aggregator: string;
    decimals: number;
    wsSymbol: string;
  };
  pricePrecision: number;
}

export interface RiskConfig {
  maxTradeSizeUsdc: number;
  limitDiscount: number;
  dailyMaxLossUsdc: number;
  maxOpenPositions: number;
  minLiquidity: number;
  maxTradesPerWindow: number;
}

export interface StrategyConfig {
  edgeThresholdEarly: number;
  edgeThresholdMid: number;
  edgeThresholdLate: number;
  minProbEarly: number;
  minProbMid: number;
  minProbLate: number;
  blendWeights: { vol: number; ta: number };
  regimeMultipliers: {
    CHOP: number;
    RANGE: number;
    TREND_ALIGNED: number;
    TREND_OPPOSED: number;
  };
}

export interface AppConfig {
  markets: MarketConfig[];
  binanceBaseUrl: string;
  gammaBaseUrl: string;
  clobBaseUrl: string;
  pollIntervalMs: number;
  candleWindowMinutes: number;
  vwapSlopeLookbackMinutes: number;
  rsiPeriod: number;
  rsiMaPeriod: number;
  macdFast: number;
  macdSlow: number;
  macdSignal: number;
  paperMode: boolean;
  polymarket: {
    marketSlug: string;
    autoSelectLatest: boolean;
    liveDataWsUrl: string;
    upOutcomeLabel: string;
    downOutcomeLabel: string;
  };
  chainlink: {
    polygonRpcUrls: string[];
    polygonRpcUrl: string;
    polygonWssUrls: string[];
    polygonWssUrl: string;
    btcUsdAggregator: string;
  };
  strategy: StrategyConfig;
  risk: RiskConfig;
  paperRisk: RiskConfig;
  liveRisk: RiskConfig;
}

export interface EdgeResult {
  marketUp: number | null;
  marketDown: number | null;
  edgeUp: number | null;
  edgeDown: number | null;
  rawSum: number | null;
  arbitrage: boolean;
  overpriced: boolean;
  vigTooHigh?: boolean;
}

export type Phase = "EARLY" | "MID" | "LATE";
export type Regime = "TREND_UP" | "TREND_DOWN" | "RANGE" | "CHOP";
export type Strength = "STRONG" | "GOOD" | "OPTIONAL";
export type Side = "UP" | "DOWN";

export interface TradeDecision {
  action: "ENTER" | "NO_TRADE";
  side: Side | null;
  phase: Phase;
  regime: Regime | null;
  strength?: Strength;
  edge?: number;
  reason?: string;
}

export interface RegimeResult {
  regime: Regime;
  reason: string;
}

export interface MacdResult {
  macd: number;
  signal: number;
  hist: number;
  histDelta: number | null;
}

export interface ScoreResult {
  upScore: number;
  downScore: number;
  rawUp: number;
}

export interface BlendResult {
  blendedUp: number;
  blendedDown: number;
  source: "blended" | "ta_only";
}

export interface CandleWindowTiming {
  startMs: number;
  endMs: number;
  elapsedMs: number;
  remainingMs: number;
  elapsedMinutes: number;
  remainingMinutes: number;
}

export interface PriceTick {
  price: number | null;
  ts?: number | null;
  updatedAt?: number | null;
  source?: string;
}

export interface OrderBookSummary {
  bestBid: number | null;
  bestAsk: number | null;
  spread: number | null;
  bidLiquidity: number | null;
  askLiquidity: number | null;
}

export interface PolymarketSnapshot {
  ok: boolean;
  reason?: string;
  market?: unknown;
  tokens?: { upTokenId: string; downTokenId: string };
  prices?: { up: number | null; down: number | null };
  orderbook?: { up: OrderBookSummary; down: OrderBookSummary };
  outcomes?: string[];
  clobTokenIds?: string[];
  outcomePrices?: string[];
}

export interface TradeSignal {
  timestamp: string;
  marketId: string;
  marketSlug: string;
  side: Side;
  phase: Phase;
  strength: Strength;
  edgeUp: number | null;
  edgeDown: number | null;
  modelUp: number;
  modelDown: number;
  marketUp: number | null;
  marketDown: number | null;
  timeLeftMin: number | null;
  spotPrice: number | null;
  priceToBeat: number | null;
  currentPrice: number | null;
  blendSource: string;
  volImpliedUp: number | null;
  volatility15m: number | null;
  binanceChainlinkDelta: number | null;
  orderbookImbalance: number | null;
  rawSum: number | null;
  arbitrage: boolean;
  tokens: { upTokenId: string; downTokenId: string } | null;
}

export interface TradeResult {
  success: boolean;
  order?: unknown;
  reason?: string;
  error?: string;
}

export interface DailyState {
  date: string;
  pnl: number;
  trades: number;
}

export interface OrderTracker {
  orders: Map<string, number>;
  lastTradeMs: number;
  cooldownMs: number;
  keyFor(marketId: string, windowSlug: string): string;
  hasOrder(marketId: string, windowSlug: string): boolean;
  totalActive(): number;
  record(marketId: string, windowSlug: string): void;
  prune(): void;
  onCooldown(): boolean;
}

export interface WsStreamHandle {
  getLast(symbol?: string): PriceTick;
  close(): void;
}

export interface RedeemResult {
  conditionId: string;
  txHash?: string;
  value?: number;
  status?: number;
  error?: string;
}

export interface PaperTradeEntry {
  id: string;
  marketId: string;
  windowStartMs: number;
  side: Side;
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

export interface PaperStats {
  totalTrades: number;
  wins: number;
  losses: number;
  pending: number;
  winRate: number;
  totalPnl: number;
}

// === Account Separation Types ===

export type AccountMode = "paper" | "live";

export interface LiveWalletState {
  address: string;
  connected: boolean;
  clientReady: boolean;
}

export interface PaperAccountState {
  initialBalance: number;
  currentBalance: number;
  maxDrawdown: number;
}

export interface AccountDailyState {
  paper: DailyState;
  live: DailyState;
}

export interface PerAccountConfig {
  paper: { risk: RiskConfig };
  live: { risk: RiskConfig };
  strategy: StrategyConfig;
}
