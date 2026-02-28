export const TRADE_TABLE_PAGE_SIZE = 10;

// Query polling intervals (ms)
export const QUERY_REFETCH_STATE_MS = 5_000;
export const QUERY_REFETCH_TRADES_MS = 15_000;
export const QUERY_REFETCH_PAPER_STATS_MS = 10_000;

// Query stale times (ms)
export const QUERY_STALE_STATE_HTTP_MS = 1_000;
export const QUERY_STALE_STATE_WS_MS = 30_000;
export const QUERY_STALE_TRADES_MS = 12_000;

// UI timing
export const TOAST_AUTO_DISMISS_MS = 3_500;
export const SAVE_STATUS_TIMEOUT_MS = 3_000;

// Shared market list
export const MARKETS = ["BTC", "ETH", "SOL", "XRP"] as const;

// Analytics buckets
export const TIMING_BUCKETS = ["0-3 min", "3-6 min", "6-9 min", "9-12 min", "12-15 min"] as const;
