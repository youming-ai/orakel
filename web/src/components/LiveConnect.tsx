import { LogOut, Wallet, WifiOff } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useLiveDisconnect } from "@/lib/queries";

interface LiveConnectProps {
	clientReady: boolean;
	walletAddress: string | null;
}

function truncateAddress(addr: string): string {
	return `${addr.slice(0, 6)}...${addr.slice(-4)}`;
}

export function LiveConnect({ clientReady, walletAddress }: LiveConnectProps) {
	const liveDisconnect = useLiveDisconnect();

	if (clientReady && walletAddress) {
		return (
			<div className="rounded-lg border border-emerald-500/20 bg-emerald-500/5 px-4 py-3">
				<div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
					<div className="flex items-center gap-3 min-w-0">
						<Wallet className="size-4 text-emerald-400 shrink-0" />
						<div className="flex flex-wrap items-center gap-2 min-w-0">
							<span className="text-sm text-muted-foreground">Trading client:</span>
							<span className="font-mono text-sm truncate">{truncateAddress(walletAddress)}</span>
							<Badge variant="default" className="bg-emerald-600 hover:bg-emerald-600 text-[11px]">
								Connected
							</Badge>
						</div>
					</div>
					<Button
						variant="outline"
						size="sm"
						className="h-7 px-3 text-xs text-red-400 border-red-500/30 hover:bg-red-500/10 shrink-0 w-full sm:w-auto"
						onClick={() => liveDisconnect.mutate()}
						disabled={liveDisconnect.isPending}
					>
						<LogOut className="size-3" />
						{liveDisconnect.isPending ? "Disconnecting..." : "Disconnect"}
					</Button>
				</div>
			</div>
		);
	}

	return (
		<div className="rounded-lg border border-border bg-card px-4 py-3">
			<div className="flex items-center gap-2 text-xs text-muted-foreground">
				<WifiOff className="size-3.5 shrink-0" />
				<span>
					Wallet not connected. Set <code className="px-1 py-0.5 rounded bg-muted font-mono">PRIVATE_KEY</code> in{" "}
					<code className="px-1 py-0.5 rounded bg-muted font-mono">.env</code> and restart the bot.
				</span>
			</div>
		</div>
	);
}
