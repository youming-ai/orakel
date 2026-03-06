import { fmtPrice } from "@/lib/format";
import { useSnapshot } from "@/lib/store";

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
				<span className="text-3xl font-light tracking-tight tabular-nums">{fmtPrice(market.id, market.spotPrice)}</span>
				{market.priceToBeat !== null && (
					<span className="text-sm text-muted-foreground font-mono">PTB {fmtPrice(market.id, market.priceToBeat)}</span>
				)}
			</div>
		</div>
	);
}
