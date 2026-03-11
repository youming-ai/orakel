import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { CHART_HEIGHT } from "@/lib/charts";

export function OverviewSkeleton() {
	return (
		<div className="space-y-4">
			{/* TodayStats placeholder */}
			<Card className="border-border/60 shadow-sm">
				<div className="p-3">
					<div className="flex flex-col gap-2.5">
						<div className="flex items-center justify-between">
							<div className="flex items-center gap-2">
								<Skeleton className="size-4 rounded bg-muted/20" />
								<Skeleton className="h-3 w-10 bg-muted/20" />
							</div>
							<div className="flex items-center gap-3">
								<Skeleton className="h-4 w-24 bg-muted/20" />
								<Skeleton className="h-3 w-14 bg-muted/20" />
							</div>
						</div>
						<div className="flex items-center gap-2">
							<Skeleton className="h-2.5 w-16 bg-muted/20" />
							<Skeleton className="flex-1 h-1.5 rounded-full bg-muted/20" />
							<Skeleton className="h-2.5 w-8 bg-muted/20" />
						</div>
					</div>
				</div>
			</Card>

			{/* Hero P&L + Stats row */}
			<div className="flex flex-col xl:flex-row xl:items-stretch gap-4">
				{/* Hero P&L card placeholder */}
				<Card className="flex flex-col justify-center p-6 border-border/60 shadow-sm shrink-0 xl:w-72 gap-0">
					<Skeleton className="h-3 w-20 mb-4 bg-muted/20" />
					<Skeleton className="h-12 w-40 mb-2 bg-muted/20" />
					<Skeleton className="h-4 w-16 bg-muted/20" />
				</Card>

				{/* Stats grid placeholder — 6 stat cells */}
				<Card className="flex-1 overflow-hidden border-border/60 shadow-sm py-0">
					<div className="grid grid-cols-2 sm:grid-cols-4 gap-px sm:gap-0 bg-border/60 sm:bg-card sm:divide-x sm:divide-border/60 h-full">
						{["trades", "winrate", "wins", "losses", "avgpnl", "streak"].map((stat) => (
							<div key={stat} className="flex flex-col gap-2 p-4 bg-card">
								<Skeleton className="h-3 w-12 bg-muted/20" />
								<Skeleton className="h-6 w-10 bg-muted/20" />
							</div>
						))}
					</div>
				</Card>
			</div>

			{/* Market cards placeholder — matches real grid-cols-1 sm:grid-cols-2 */}
			<div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4">
				{["market-a", "market-b"].map((id) => (
					<Card key={id} className="border-border/60 shadow-sm">
						<CardHeader className="pb-3">
							<div className="flex items-center justify-between">
								<div className="flex items-center gap-2">
									<Skeleton className="size-2.5 rounded-full bg-muted/20" />
									<Skeleton className="h-4 w-20 bg-muted/20" />
								</div>
								<Skeleton className="h-3 w-10 bg-muted/20" />
							</div>
							<Skeleton className="h-7 w-32 mt-1 bg-muted/20" />
						</CardHeader>
						<CardContent className="space-y-4 pt-0">
							<Skeleton className="h-14 w-full rounded-lg bg-muted/20" />
							<Skeleton className="h-4 w-full bg-muted/20" />
							<Skeleton className="h-8 w-full rounded-md bg-muted/20" />
						</CardContent>
					</Card>
				))}
			</div>

			{/* P&L Chart placeholder */}
			<Card className="border-border/60 shadow-sm">
				<CardHeader className="pb-2">
					<Skeleton className="h-3 w-28 bg-muted/20" />
				</CardHeader>
				<CardContent className={CHART_HEIGHT.responsive}>
					<Skeleton className="h-full w-full rounded-lg bg-muted/20" />
				</CardContent>
			</Card>
		</div>
	);
}
