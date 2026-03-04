# Frontend UI Review & Optimization Plan

This document outlines the findings from the review of the `orakel` frontend (`web/` directory) and proposes practical steps to streamline and optimize the UI architecture.

## Findings: Areas for Streamlining and Optimization

### 1. Separation of Concerns (Data Logic in View Components)
**Issue:** [Dashboard.tsx](file:///Users/youming/GitHub/orakel/web/src/components/Dashboard.tsx) and [AnalyticsTabs.tsx](file:///Users/youming/GitHub/orakel/web/src/components/AnalyticsTabs.tsx) both contain heavy data transformation logic, and duplicate identical logic (e.g., `pnlTimeline` calculation). React query is used, but the transformation happens in the render cycle rather than the fetching/store layer.
**Optimization:**
- Extract data transformation functions ([buildStatsFromTrades](file:///Users/youming/GitHub/orakel/web/src/components/AnalyticsTabs.tsx#30-54), [buildMarketFromTrades](file:///Users/youming/GitHub/orakel/web/src/components/AnalyticsTabs.tsx#55-85), `liveTradesAsPaper`, `pnlTimeline`) into a dedicated `src/lib/transformers.ts` or `src/lib/stats.ts` module.
- Move these calculations out of the React render body. Alternatively, move them into the `select` option of the `useQuery` hooks in [src/lib/queries.ts](file:///Users/youming/GitHub/orakel/web/src/lib/queries.ts) so the components receive correctly formatted data natively.

### 2. Component Bloat & Abstraction Opportunities
**Issue:** Several key components have grown very large and mix complex internal state/helpers with UI markup.
**Optimization:**
- **[MarketCard.tsx](file:///Users/youming/GitHub/orakel/web/src/components/MarketCard.tsx) (~260 lines):** Extract the inline helper functions ([macdLabel](file:///Users/youming/GitHub/orakel/web/src/components/MarketCard.tsx#11-21), [confidenceColor](file:///Users/youming/GitHub/orakel/web/src/components/MarketCard.tsx#22-27), [confidenceBg](file:///Users/youming/GitHub/orakel/web/src/components/MarketCard.tsx#28-33)) and sub-components ([ConfidenceBar](file:///Users/youming/GitHub/orakel/web/src/components/MarketCard.tsx#53-77), [MiniTrend](file:///Users/youming/GitHub/orakel/web/src/components/MarketCard.tsx#34-52), [SignalLight](file:///Users/youming/GitHub/orakel/web/src/components/MarketCard.tsx#78-98)) into their own files in a new `src/components/market/` directory or place them in [lib/format.ts](file:///Users/youming/GitHub/orakel/web/src/lib/format.ts)/[lib/utils.ts](file:///Users/youming/GitHub/orakel/web/src/lib/utils.ts).
- **[TradeTable.tsx](file:///Users/youming/GitHub/orakel/web/src/components/TradeTable.tsx) (~250 lines):** This component handles two entirely different layouts natively (stacked cards for mobile, table for desktop). Split this into `TradeTableMobile.tsx` and `TradeTableDesktop.tsx` to make the main file simply a responsive wrapper, drastically improving readability.
- **[Header.tsx](file:///Users/youming/GitHub/orakel/web/src/components/Header.tsx) (~190 lines):** Extract the [useCycleCountdown](file:///Users/youming/GitHub/orakel/web/src/components/Header.tsx#66-85) custom hook to `src/hooks/useCycleCountdown.ts`. Extract the [StatusIcon](file:///Users/youming/GitHub/orakel/web/src/components/Header.tsx#49-65) component if reused, or at least simplify the inline Tailwind conditionals using `cva` (class-variance-authority, which is already in [package.json](file:///Users/youming/GitHub/orakel/package.json)).

### 3. Project Structure Semantics
**Issue:** [Dashboard.tsx](file:///Users/youming/GitHub/orakel/web/src/components/Dashboard.tsx) acts as a primary route but is located in `src/components/`, while `TradesPage` is in [src/pages/Trades.tsx](file:///Users/youming/GitHub/orakel/web/src/pages/Trades.tsx). 
**Optimization:**
- Move [Dashboard.tsx](file:///Users/youming/GitHub/orakel/web/src/components/Dashboard.tsx) to `src/pages/Dashboard.tsx` to clearly differentiate top-level route pages from reusable UI components.

### 4. Styling & Tailwind Clutter
**Issue:** Extensive use of inline Tailwind conditionals (e.g. `isUp ? "bg-emerald-500/15 text-emerald-400" : "bg-red-500/15 text-red-400"`) makes JSX visually noisy.
**Optimization:**
- Utilize `cva` to define clear, readable component variants (especially for Badges, Signal Lights, and Status tags) instead of concatenating strings with ternaries in the markup.

## Verification Plan

### Automated Tests
- Run TS type checking: `bun x tsc --noEmit` to ensure no Typescript breakages during refactoring.
- Run UI tests if they exist. (Need to confirm if `vitest` tests cover the visual components).
- Run `bun run build` to ensure the production build succeeds after the code movements.

### Manual Verification
- After optimizations, load the dev server (`bun run dev`) and manually inspect:
  - The Dashboard statistics logic (ensure PnL, Win Rates, and total trades match identically).
  - The Trading logs page (ensure both mobile card stack and desktop table modes render correctly).
  - The Header countdown timer and status ping.
  - The [MarketCard](file:///Users/youming/GitHub/orakel/web/src/components/MarketCard.tsx#99-259) and its complex conditionally-styled elements (ConfidenceBar, SignalLight).
