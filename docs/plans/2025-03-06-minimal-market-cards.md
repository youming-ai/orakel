# Minimal Luxury Market Cards Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Refactor MarketCard to extract global price info and adopt a minimal luxury design with simplified indicators and premium micro-interactions.

**Architecture:** Create a GlobalPriceBar component for the floating price header, simplify MarketCard to show only timeframe-specific data, reduce indicators from 8 to 4 key metrics, and add subtle hover/animation effects.

**Tech Stack:** React 19, TypeScript, Tailwind v4, shadcn/ui, framer-motion (for animations)

---

## Prerequisites

Before starting, ensure:
- Frontend dependencies installed: `cd web && bun install`
- Dev server can start: `cd web && bun run dev` (runs on port 5173)
- Check existing components: `web/src/components/MarketCard.tsx`, `web/src/components/market/MarketIndicators.tsx`
- Check types: `web/src/lib/api.ts` for MarketSnapshot interface

---

## Task 1: Create GlobalPriceBar Component

**Files:**
- Create: `web/src/components/GlobalPriceBar.tsx`

**Step 1: Create component file**

```tsx
import { useSnapshot } from "@/lib/store";
import { fmtPrice } from "@/lib/format";

export function GlobalPriceBar() {
	const snapshot = useSnapshot();
	const market = snapshot?.markets?.[0]; // All markets share same base price

	if (!market?.ok) return null;

	return (
		<div className="sticky top-0 z-10 backdrop-blur-md bg-background/80 border-b">
			<div className="flex items-baseline gap-6 px-6 py-4">
				<span className="text-sm font-medium text-muted-foreground tracking-wide uppercase">
					{market.id.split("-")[0]}
				</span>
				<span className="text-3xl font-light tracking-tight tabular-nums">
					{fmtPrice(market.id, market.spotPrice)}
				</span>
				{market.priceToBeat !== null && (
					<span className="text-sm text-muted-foreground font-mono">
						PTB {fmtPrice(market.id, market.priceToBeat)}
					</span>
				)}
			</div>
		</div>
	);
}
```

**Step 2: Add to Dashboard**

Modify: `web/src/components/Dashboard.tsx` (find the file and add GlobalPriceBar import and usage)

```tsx
import { GlobalPriceBar } from "./GlobalPriceBar";

// In the component render, add GlobalPriceBar before the grid
```

**Step 3: Verify it renders**

Run dev server and check the global price bar appears at the top with sticky behavior.

**Step 4: Commit**

```bash
git add web/src/components/GlobalPriceBar.tsx web/src/components/Dashboard.tsx
git commit -m "feat: add GlobalPriceBar component for extracted price display"
```

---

## Task 2: Simplify MarketIndicators

**Files:**
- Modify: `web/src/components/market/MarketIndicators.tsx`
- Check: Existing exports that MarketCard uses

**Step 1: Create simplified indicator set**

Add to `MarketIndicators.tsx` or create new exports:

```tsx
import { cn } from "@/lib/utils";
import type { MarketSnapshot } from "@/lib/api";

interface SimplifiedIndicatorsProps {
	market: MarketSnapshot;
}

export function SimplifiedIndicators({ market: m }: SimplifiedIndicatorsProps) {
	// HA Trend dots
	const haDots = Array.from({ length: Math.min(m.haConsecutive ?? 0, 3) }, (_, i) => (
		<div
			key={i}
			className={cn(
				"w-1.5 h-1.5 rounded-full",
				m.haColor === "green" ? "bg-emerald-500" : "bg-red-500"
			)}
		/>
	));

	// RSI color
	const rsiValue = m.rsi ?? 50;
	const rsiColor = rsiValue > 70 ? "text-red-400" : rsiValue < 30 ? "text-emerald-400" : "text-muted-foreground";

	// VWAP position
	const vwapPosition = (m.vwapSlope ?? 0) > 0 ? "Above" : "Below";

	return (
		<div className="flex items-center justify-between text-[11px]">
			{/* HA Trend */}
			<div className="flex flex-col gap-1">
				<span className="text-[10px] uppercase text-muted-foreground">HA</span>
				<div className="flex gap-0.5">{haDots}</div>
			</div>

			{/* RSI */}
			<div className="flex flex-col gap-1">
				<span className="text-[10px] uppercase text-muted-foreground">RSI</span>
				<span className={cn("font-mono font-medium", rsiColor)}>
					{m.rsi?.toFixed(1) ?? "-"}
				</span>
			</div>

			{/* VWAP */}
			<div className="flex flex-col gap-1">
				<span className="text-[10px] uppercase text-muted-foreground">VWAP</span>
				<span className="font-mono font-medium">{vwapPosition}</span>
			</div>

			{/* Imbalance */}
			<div className="flex flex-col gap-1">
				<span className="text-[10px] uppercase text-muted-foreground">Imb</span>
				<span className={cn(
					"font-mono font-medium",
					(m.orderbookImbalance ?? 0) > 0 ? "text-emerald-400" : "text-red-400"
				)}>
					{m.orderbookImbalance !== null ? `${(m.orderbookImbalance * 100).toFixed(0)}%` : "-"}
				</span>
			</div>
		</div>
	);
}
```

**Step 2: Verify types compile**

```bash
cd web && bun run typecheck
```

**Step 3: Commit**

```bash
git add web/src/components/market/MarketIndicators.tsx
git commit -m "feat: add simplified indicators for minimal card design"
```

---

## Task 3: Refactor MarketCard Component

**Files:**
- Modify: `web/src/components/MarketCard.tsx`
- Use: `SimplifiedIndicators` from Task 2

**Step 1: Rewrite MarketCard with minimal design**

```tsx
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import type { MarketSnapshot } from "@/lib/api";
import { fmtCents, fmtMinSec, fmtPrice } from "@/lib/format";
import { cn } from "@/lib/utils";
import { SimplifiedIndicators } from "./market/MarketIndicators";

interface MarketCardProps {
	market: MarketSnapshot;
}

export function MarketCard({ market: m }: MarketCardProps) {
	if (!m.ok) {
		return (
			<Card className="border-red-500/30 bg-red-500/10 p-4">
				<p className="text-sm text-red-400">Error: {m.error ?? "Unknown"}</p>
			</Card>
		);
	}

	const isLong = m.predictDirection === "LONG";
	const isEntry = m.action === "ENTER";

	return (
		<Card
			className={cn(
				"relative overflow-hidden transition-all duration-300",
				"bg-muted/30 border-border/50",
				"hover:bg-muted/50 hover:border-border/80 hover:-translate-y-0.5",
				"rounded-xl"
			)}
		>
			<CardContent className="p-4 space-y-4">
				{/* Header: Signal + ID + Phase */}
				<div className="flex items-center justify-between">
					<div className="flex items-center gap-2">
						<div
							className={cn(
								"w-2 h-2 rounded-full transition-colors duration-500",
								isEntry ? (isLong ? "bg-emerald-500" : "bg-red-500") : "bg-muted-foreground/30"
							)}
						/>
						<span className="font-semibold text-sm">{m.id}</span>
					</div>
					<div className="flex items-center gap-2">
						{m.phase && (
							<Badge variant="secondary" className="text-[10px] px-1.5 py-0">
								{m.phase}
							</Badge>
						)}
						<span className="font-mono text-[10px] text-muted-foreground">
							{fmtMinSec(m.timeLeftMin)}
						</span>
					</div>
				</div>

				{/* Main Signal */}
				<div className="text-center py-2">
					<div
						className={cn(
							"text-2xl font-light tracking-tight",
							isLong ? "text-emerald-500" : "text-red-500"
						)}
					>
						{isLong ? "LONG" : "SHORT"} {isLong ? m.predictLong : m.predictShort}%
					</div>
				</div>

				{/* Odds */}
				<div className="flex justify-center gap-4 text-[11px] font-mono">
					<span className="text-emerald-400">UP {fmtCents(m.marketUp)}</span>
					<span className="text-muted-foreground/30">|</span>
					<span className="text-red-400">DN {fmtCents(m.marketDown)}</span>
				</div>

				{/* Simplified Indicators */}
				<div className="pt-2 border-t border-border/30">
					<SimplifiedIndicators market={m} />
				</div>

				{/* Action Button */}
				{isEntry ? (
					<div
						className={cn(
							"rounded-lg px-3 py-2 text-xs font-semibold text-center",
							"bg-primary/10 text-primary border border-primary/30",
							"animate-in fade-in slide-in-from-bottom-2 duration-500"
						)}
					>
						<span className="flex items-center justify-center gap-2">
							<span>BUY {m.side}</span>
							<span className="text-primary/40">|</span>
							<span className="font-mono">Edge {((m.edge ?? 0) * 100).toFixed(1)}%</span>
						</span>
					</div>
				) : (
					<div className="text-center text-[11px] text-muted-foreground uppercase tracking-wide py-2">
						{m.reason ?? "NO TRADE"}
					</div>
				)}
			</CardContent>
		</Card>
	);
}
```

**Step 2: Type check**

```bash
cd web && bun run typecheck
```

**Step 3: Visual check**

Run dev server and verify:
- [ ] Cards have minimal border and hover lift effect
- [ ] No price/PTB shown in cards
- [ ] Simplified indicators display correctly (HA dots, RSI, VWAP, Imbalance)
- [ ] Signal button appears only for ENTER action
- [ ] Font hierarchy is clean (light weight for numbers)

**Step 4: Commit**

```bash
git add web/src/components/MarketCard.tsx
git commit -m "refactor: simplify MarketCard with minimal luxury design"
```

---

## Task 4: Update Dashboard Layout

**Files:**
- Modify: `web/src/components/Dashboard.tsx`

**Step 1: Find and update Dashboard component**

Locate the Dashboard component and ensure it:
1. Imports and renders GlobalPriceBar at the top
2. Renders MarketCards in a responsive grid
3. Has proper spacing between GlobalPriceBar and cards

Expected structure:
```tsx
<div className="min-h-screen bg-background">
	<GlobalPriceBar />
	<div className="p-4 sm:p-6">
		<div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
			{markets.map(m => <MarketCard key={m.id} market={m} />)}
		</div>
	</div>
</div>
```

**Step 2: Responsive grid verification**

Check the grid classes handle:
- Mobile: 1 column
- Tablet: 2 columns
- Desktop: 4 columns

**Step 3: Commit**

```bash
git add web/src/components/Dashboard.tsx
git commit -m "feat: integrate GlobalPriceBar and responsive grid layout"
```

---

## Task 5: Add Price Animation

**Files:**
- Modify: `web/src/components/GlobalPriceBar.tsx`
- Install: framer-motion (if not present)

**Step 1: Check if framer-motion is installed**

```bash
cd web && cat package.json | grep framer
```

If not installed:
```bash
cd web && bun add framer-motion
```

**Step 2: Add price change animation**

Update GlobalPriceBar with motion:

```tsx
import { motion, AnimatePresence } from "framer-motion";

// In the price display:
<motion.span
	key={market.spotPrice}
	initial={{ opacity: 0.5, y: -2 }}
	animate={{ opacity: 1, y: 0 }}
	transition={{ duration: 0.3 }}
	className="text-3xl font-light tracking-tight tabular-nums"
>
	{fmtPrice(market.id, market.spotPrice)}
</motion.span>
```

**Step 3: Commit**

```bash
git add web/src/components/GlobalPriceBar.tsx web/package.json
git commit -m "feat: add smooth price update animations"
```

---

## Task 6: Final Polish and Testing

**Step 1: Run all checks**

```bash
cd web
bun run typecheck
bun run lint
```

**Step 2: Visual regression check**

- [ ] GlobalPriceBar sticks to top when scrolling
- [ ] 4 MarketCards display in grid
- [ ] No price/PTB in individual cards
- [ ] Indicators show: HA dots, RSI number, VWAP Above/Below, Imbalance %
- [ ] Hover effects work (lift + border brighten)
- [ ] Mobile: cards stack vertically
- [ ] Tablet: 2×2 grid
- [ ] Desktop: 1×4 horizontal row

**Step 3: Final commit**

```bash
git add -A
git commit -m "feat: complete minimal luxury market cards redesign

- Extract global price to floating GlobalPriceBar
- Simplify MarketCard: remove price/PTB, reduce indicators to 4
- Add subtle hover animations and price update transitions
- Responsive grid layout for all screen sizes"
```

---

## Verification Commands

```bash
# Type checking
cd web && bun run typecheck

# Linting
cd web && bun run lint

# Dev server
cd web && bun run dev

# Build check
cd web && bun run build
```

---

## Rollback Plan

If issues arise:
1. Keep old MarketCard.tsx as backup before modifying
2. Can revert individual commits: `git revert HEAD~N`
3. Original functionality preserved in git history

---

## Notes for Implementer

- **MarketSnapshot interface**: Check `web/src/lib/api.ts` for exact field names
- **Existing helpers**: `fmtPrice`, `fmtCents`, `fmtMinSec` in `web/src/lib/format.ts`
- **Store hook**: `useSnapshot` from `web/src/lib/store.ts` provides global state
- **Color tokens**: Use Tailwind's `emerald-500` for positive, `red-500` for negative
- **shadcn components**: Card, Badge from `@/components/ui/*`
