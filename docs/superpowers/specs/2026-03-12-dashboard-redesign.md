# Dashboard Redesign — Single BTC-5m Market

## Context

The bot was rewritten for a single BTC 5-minute Polymarket market. The frontend still assumes multi-market (BTC+ETH) with a 2-column market card grid, ETH icons, and stats-first layout. This redesign restructures the dashboard around the single market signal as the hero element.

## Decisions

- **Layout**: Split — Signal+Chart left (60%), Stats sidebar right (40%). Stacks on mobile (signal first).
- **Signal Card**: Dense & data-rich — BTC price with decimals, PTB, delta %, 4-column indicator grid, confidence bar, action CTA.
- **Information hierarchy**: Live signal → Today P&L → Total stats → P&L chart.

## Desktop Layout (xl+)

```
┌──────────────────────────────────────────┐
│              Header (unchanged)           │
├───────────────────────┬──────────────────┤
│   SignalCard (hero)   │  TodayPnlCard    │
│   - BTC price+decimals│  - pnl, trades   │
│   - LONG/SHORT + %   │  - daily limit    │
│   - 4-col indicators  │                  │
│   - confidence bar    │  TotalPnlCard    │
│   - action CTA        │  - total pnl     │
│                       │  - best/worst/PF │
│   PnlTimelineChart    │                  │
│                       │  MiniStatsGrid   │
│                       │  - W / L         │
│                       │  - Avg / Streak  │
└───────────────────────┴──────────────────┘
```

## Mobile Layout (< xl)

Single column: SignalCard → TodayPnlCard → MiniStatsGrid → PnlTimelineChart

## Component Changes

| Component | Action | Details |
|-----------|--------|---------|
| `OverviewTab.tsx` | Rewrite | Split layout, remove `MARKET_ORDER`, single SignalCard hero |
| `MarketCard.tsx` → `SignalCard.tsx` | Rename+rewrite | Remove ETH, full-width, BTC price 2 decimals, delta as %, inline indicators |
| `SimplifiedIndicators.tsx` | Delete (inline) | 4-col grid inlined into SignalCard |
| `HeroPnlCard.tsx` | Rewrite compact | Sidebar-sized: total P&L + best/worst/PF |
| `TodayStatsCard.tsx` | Rewrite compact | Sidebar-sized: today P&L + trades + daily limit bar |
| `StatsGrid.tsx` | Rewrite 2x2 | 4 cells: Wins, Losses, Avg P&L, Streak |
| `OverviewSkeleton.tsx` | Update | Match split layout, 1 signal placeholder |
| `MarketComparisonTable.tsx` | Delete | Single market, no comparison |
| `EthIcon.tsx` | Delete | No ETH markets |
| `format.ts` `fmtPrice` | Fix | BTC → 2 decimal places |

## Dead Code Removal

- `components/icons/EthIcon.tsx` + export from `index.ts`
- `components/MarketComparisonTable.tsx`
- `components/market/SimplifiedIndicators.tsx`
- `mappers.ts` ETH branch in `marketIdFromSlug`
- `OverviewTab.tsx` `MARKET_ORDER` constant

## Unchanged

- `Header.tsx`, `BottomNav.tsx` — navigation unchanged
- `PnlTimelineChart.tsx` — chart unchanged, just repositioned
- `TradeTable.tsx`, `TradesTab.tsx` — /logs page unchanged
- All `lib/`, `contracts/`, `entities/`, `app/ws/` — data layer unchanged
- Bot package — no changes needed
