import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { CHART_HEIGHT } from "@/lib/charts";

export function OverviewSkeleton() {
	return (
		<div className="space-y-4">
			<div className="flex flex-col gap-4 xl:flex-row xl:items-start">
				<div className="flex flex-col gap-4 xl:flex-[3]">
					<Card className="border-border/60 bg-muted/20 shadow-sm">
						<CardContent className="space-y-4 p-4 sm:p-5">
							<div className="flex items-center justify-between">
								<div className="flex items-center gap-2.5">
									<Skeleton className="size-2.5 rounded-full bg-muted/20" />
									<Skeleton className="h-4 w-16 bg-muted/20" />
									<Skeleton className="h-3 w-20 bg-muted/20" />
								</div>
								<div className="flex items-center gap-2">
									<Skeleton className="h-4 w-12 bg-muted/20" />
									<Skeleton className="h-3 w-10 bg-muted/20" />
								</div>
							</div>
							<Skeleton className="h-12 w-44 mx-auto bg-muted/20" />
							<Skeleton className="h-3 w-52 mx-auto bg-muted/20" />
							<div className="grid grid-cols-4 gap-0.5">
								{["edge", "up", "down", "vol"].map((item) => (
									<div key={item} className="space-y-1 rounded bg-muted/15 p-2 text-center">
										<Skeleton className="h-2.5 w-10 mx-auto bg-muted/20" />
										<Skeleton className="h-3.5 w-12 mx-auto bg-muted/20" />
									</div>
								))}
							</div>
							<div className="flex items-center gap-2">
								<Skeleton className="h-3 w-16 bg-muted/20" />
								<Skeleton className="h-1.5 flex-1 rounded-full bg-muted/20" />
								<Skeleton className="h-3 w-10 bg-muted/20" />
							</div>
							<Skeleton className="h-9 w-full rounded-md bg-muted/20" />
						</CardContent>
					</Card>

					<Card className="border-border/60 shadow-sm">
						<CardHeader className="pb-2">
							<Skeleton className="h-3 w-28 bg-muted/20" />
						</CardHeader>
						<CardContent className={CHART_HEIGHT.responsive}>
							<Skeleton className="h-full w-full rounded-lg bg-muted/20" />
						</CardContent>
					</Card>
				</div>

				<div className="flex flex-col gap-4 xl:flex-[2]">
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
									<Skeleton className="h-1.5 flex-1 rounded-full bg-muted/20" />
									<Skeleton className="h-2.5 w-8 bg-muted/20" />
								</div>
							</div>
						</div>
					</Card>

					<Card className="border-border/60 p-6 shadow-sm">
						<Skeleton className="mb-4 h-3 w-20 bg-muted/20" />
						<Skeleton className="mb-2 h-12 w-40 bg-muted/20" />
						<Skeleton className="h-4 w-16 bg-muted/20" />
					</Card>

					<Card className="overflow-hidden border-border/60 py-0 shadow-sm">
						<div className="grid grid-cols-2 sm:grid-cols-3 gap-1.5 p-1.5 sm:gap-3 sm:p-3">
							{["trades", "winrate", "wins", "losses", "avg", "streak"].map((stat) => (
								<div key={stat} className="space-y-2 rounded-md border border-border/40 p-3">
									<Skeleton className="h-3 w-12 bg-muted/20" />
									<Skeleton className="h-6 w-10 bg-muted/20" />
								</div>
							))}
						</div>
					</Card>
				</div>
			</div>
		</div>
	);
}
