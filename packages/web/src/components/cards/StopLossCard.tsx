import { AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import type { StopLossStatus } from "@/contracts/http";
import { fmtTime } from "@/lib/format";

interface StopLossCardProps {
	stopLoss: StopLossStatus | null | undefined;
	onReset: () => void;
	isPending: boolean;
}

export function StopLossCard({ stopLoss, onReset, isPending }: StopLossCardProps) {
	if (!stopLoss?.stoppedAt) return null;

	return (
		<Card className="border-red-500/30 bg-red-500/5 shadow-sm">
			<div className="p-3">
				<div className="flex items-center gap-3">
					<AlertTriangle className="size-5 text-red-400" />
					<div className="flex-1">
						<p className="text-sm font-medium text-red-400">Trading Stopped</p>
						<p className="text-xs text-red-400/70">
							Reason: {stopLoss.reason} • Since {fmtTime(stopLoss.stoppedAt)}
						</p>
					</div>
					<Button
						size="sm"
						variant="outline"
						className="h-7 text-xs border-red-400/50 text-red-400 hover:bg-red-400/10"
						onClick={onReset}
						disabled={isPending}
					>
						{isPending ? "Resetting..." : "Reset & Resume"}
					</Button>
				</div>
			</div>
		</Card>
	);
}
