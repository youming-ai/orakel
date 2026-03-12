import { TradesTab } from "@/components/analytics/TradesTab";
import { useTrades } from "@/lib/queries";
import { useUIStore } from "@/lib/store";

export function TradesPanel() {
	const viewMode = useUIStore((s) => s.viewMode);
	const { data: trades = [] } = useTrades(viewMode);

	return (
		<main className="p-3 sm:p-6 space-y-4 sm:space-y-6 max-w-7xl mx-auto pb-20 sm:pb-6">
			<div className="rounded-xl border bg-card p-4 sm:p-6 shadow-sm">
				<TradesTab viewMode={viewMode} liveTrades={trades} />
			</div>
		</main>
	);
}
