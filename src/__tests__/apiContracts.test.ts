import { describe, expect, it } from "vitest";
import type {
	BalanceDto,
	DashboardStateDto,
	PaperStatsResponseDto,
	StopLossStatusDto,
	TodayStatsDto,
	TradeRecordDto,
} from "../contracts/http.ts";
import type {
	BalanceSnapshotPayload,
	SignalNewPayload,
	StateSnapshotPayload,
	TradeExecutedPayload,
} from "../contracts/stateTypes.ts";

describe("API contract shapes", () => {
	describe("DashboardStateDto", () => {
		it("should have required fields", () => {
			const _shapeCheck = (dto: DashboardStateDto) => {
				const _markets = dto.markets;
				const _updatedAt = dto.updatedAt;
				const _paperMode = dto.paperMode;
				const _wallet = dto.wallet;
				const _paperDaily = dto.paperDaily;
				const _liveDaily = dto.liveDaily;
				const _config = dto.config;
				const _paperRunning = dto.paperRunning;
				const _liveRunning = dto.liveRunning;
				const _paperStats = dto.paperStats;
				const _liveStats = dto.liveStats;
				const _paperBalance = dto.paperBalance;
				const _liveBalance = dto.liveBalance;
				const _liveWallet = dto.liveWallet;
				const _paperPendingStart = dto.paperPendingStart;
				const _paperPendingStop = dto.paperPendingStop;
				const _livePendingStart = dto.livePendingStart;
				const _livePendingStop = dto.livePendingStop;
				const _paperPendingSince = dto.paperPendingSince;
				const _livePendingSince = dto.livePendingSince;
				const _stopLoss = dto.stopLoss;
				const _liveStopLoss = dto.liveStopLoss;
				const _todayStats = dto.todayStats;
				const _liveTodayStats = dto.liveTodayStats;

				void [
					_markets,
					_updatedAt,
					_paperMode,
					_wallet,
					_paperDaily,
					_liveDaily,
					_config,
					_paperRunning,
					_liveRunning,
					_paperStats,
					_liveStats,
					_paperBalance,
					_liveBalance,
					_liveWallet,
					_paperPendingStart,
					_paperPendingStop,
					_livePendingStart,
					_livePendingStop,
					_paperPendingSince,
					_livePendingSince,
					_stopLoss,
					_liveStopLoss,
					_todayStats,
					_liveTodayStats,
				];
			};
			expect(_shapeCheck).toBeDefined();
		});
	});

	describe("PaperStatsResponseDto", () => {
		it("should have required fields", () => {
			const _shapeCheck = (dto: PaperStatsResponseDto) => {
				const _stats = dto.stats;
				const _trades = dto.trades;
				const _byMarket = dto.byMarket;
				const _balance = dto.balance;
				const _stopLoss = dto.stopLoss;
				const _todayStats = dto.todayStats;

				void [_stats, _trades, _byMarket, _balance, _stopLoss, _todayStats];
			};
			expect(_shapeCheck).toBeDefined();
		});
	});

	describe("TradeRecordDto", () => {
		it("should have required fields", () => {
			const _shapeCheck = (dto: TradeRecordDto) => {
				const _timestamp = dto.timestamp;
				const _market = dto.market;
				const _marketSlug = dto.marketSlug;
				const _side = dto.side;
				const _amount = dto.amount;
				const _price = dto.price;
				const _orderId = dto.orderId;
				const _status = dto.status;
				const _mode = dto.mode;
				const _pnl = dto.pnl;
				const _won = dto.won;
				const _currentPriceAtEntry = dto.currentPriceAtEntry;

				void [
					_timestamp,
					_market,
					_marketSlug,
					_side,
					_amount,
					_price,
					_orderId,
					_status,
					_mode,
					_pnl,
					_won,
					_currentPriceAtEntry,
				];
			};
			expect(_shapeCheck).toBeDefined();
		});
	});

	describe("BalanceDto", () => {
		it("should have required fields", () => {
			const _shapeCheck = (dto: BalanceDto) => {
				const _initial = dto.initial;
				const _current = dto.current;
				const _maxDrawdown = dto.maxDrawdown;
				const _reserved = dto.reserved;

				void [_initial, _current, _maxDrawdown, _reserved];
			};
			expect(_shapeCheck).toBeDefined();
		});
	});

	describe("StopLossStatusDto", () => {
		it("should have required fields", () => {
			const _shapeCheck = (dto: StopLossStatusDto) => {
				const _stoppedAt = dto.stoppedAt;
				const _reason = dto.reason;

				void [_stoppedAt, _reason];
			};
			expect(_shapeCheck).toBeDefined();
		});
	});

	describe("TodayStatsDto", () => {
		it("should have required fields", () => {
			const _shapeCheck = (dto: TodayStatsDto) => {
				const _pnl = dto.pnl;
				const _trades = dto.trades;
				const _limit = dto.limit;

				void [_pnl, _trades, _limit];
			};
			expect(_shapeCheck).toBeDefined();
		});
	});
});

describe("WS payload shapes", () => {
	describe("StateSnapshotPayload", () => {
		it("should have required fields", () => {
			const _shapeCheck = (payload: StateSnapshotPayload) => {
				const _markets = payload.markets;
				const _updatedAt = payload.updatedAt;
				const _paperRunning = payload.paperRunning;
				const _liveRunning = payload.liveRunning;
				const _paperPendingStart = payload.paperPendingStart;
				const _paperPendingStop = payload.paperPendingStop;
				const _livePendingStart = payload.livePendingStart;
				const _livePendingStop = payload.livePendingStop;
				const _paperPendingSince = payload.paperPendingSince;
				const _livePendingSince = payload.livePendingSince;
				const _paperStats = payload.paperStats;
				const _liveStats = payload.liveStats;
				const _liveTodayStats = payload.liveTodayStats;

				void [
					_markets,
					_updatedAt,
					_paperRunning,
					_liveRunning,
					_paperPendingStart,
					_paperPendingStop,
					_livePendingStart,
					_livePendingStop,
					_paperPendingSince,
					_livePendingSince,
					_paperStats,
					_liveStats,
					_liveTodayStats,
				];
			};
			expect(_shapeCheck).toBeDefined();
		});
	});

	describe("SignalNewPayload", () => {
		it("should have required fields", () => {
			const _shapeCheck = (payload: SignalNewPayload) => {
				const _marketId = payload.marketId;
				const _timestamp = payload.timestamp;
				const _regime = payload.regime;
				const _signal = payload.signal;
				const _modelUp = payload.modelUp;
				const _modelDown = payload.modelDown;
				const _edgeUp = payload.edgeUp;
				const _edgeDown = payload.edgeDown;
				const _recommendation = payload.recommendation;

				void [_marketId, _timestamp, _regime, _signal, _modelUp, _modelDown, _edgeUp, _edgeDown, _recommendation];
			};
			expect(_shapeCheck).toBeDefined();
		});
	});

	describe("TradeExecutedPayload", () => {
		it("should have required fields", () => {
			const _shapeCheck = (payload: TradeExecutedPayload) => {
				const _marketId = payload.marketId;
				const _mode = payload.mode;
				const _side = payload.side;
				const _price = payload.price;
				const _size = payload.size;
				const _timestamp = payload.timestamp;
				const _orderId = payload.orderId;
				const _status = payload.status;

				void [_marketId, _mode, _side, _price, _size, _timestamp, _orderId, _status];
			};
			expect(_shapeCheck).toBeDefined();
		});
	});

	describe("BalanceSnapshotPayload", () => {
		it("should have required fields", () => {
			const _shapeCheck = (payload: BalanceSnapshotPayload) => {
				const _usdcBalance = payload.usdcBalance;
				const _usdcRaw = payload.usdcRaw;
				const _positions = payload.positions;
				const _blockNumber = payload.blockNumber;
				const _timestamp = payload.timestamp;

				void [_usdcBalance, _usdcRaw, _positions, _blockNumber, _timestamp];
			};
			expect(_shapeCheck).toBeDefined();
		});
	});
});
