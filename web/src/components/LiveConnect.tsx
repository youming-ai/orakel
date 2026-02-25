import { AlertTriangle, LogOut, Wallet } from "lucide-react";
import { useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useLiveConnect, useLiveDisconnect } from "@/lib/queries";
import { ConnectWallet } from "./ConnectWallet";

interface LiveConnectProps {
	clientReady: boolean;
	walletAddress: string | null;
}

function truncateAddress(addr: string): string {
	return `${addr.slice(0, 6)}...${addr.slice(-4)}`;
}

export function LiveConnect({ clientReady, walletAddress }: LiveConnectProps) {
	const [privateKey, setPrivateKey] = useState("");
	const liveConnect = useLiveConnect();
	const liveDisconnect = useLiveDisconnect();

	// Clear private key from memory on unmount
	useEffect(() => {
		return () => setPrivateKey("");
	}, []);

	const handleConnect = () => {
		if (!privateKey.trim()) return;
		liveConnect.mutate(privateKey.trim(), {
			onSuccess: (data) => {
				if (data.ok) setPrivateKey("");
			},
		});
	};

	const handleDisconnect = () => {
		liveDisconnect.mutate();
	};

	if (clientReady && walletAddress) {
		return (
			<div className="rounded-lg border border-emerald-500/20 bg-emerald-500/5 px-4 py-3 space-y-2">
				<div className="flex items-center justify-between">
					<div className="flex items-center gap-3">
						<Wallet className="size-4 text-emerald-400" />
						<div className="flex items-center gap-2">
							<span className="text-sm text-muted-foreground">Trading client:</span>
							<span className="font-mono text-sm">{truncateAddress(walletAddress)}</span>
							<Badge variant="default" className="bg-emerald-600 hover:bg-emerald-600 text-[11px]">
								Connected
							</Badge>
						</div>
					</div>
					<Button
						variant="outline"
						size="sm"
						className="h-7 px-3 text-xs text-red-400 border-red-500/30 hover:bg-red-500/10"
						onClick={handleDisconnect}
						disabled={liveDisconnect.isPending}
					>
						<LogOut className="size-3" />
						{liveDisconnect.isPending ? "Disconnecting..." : "Disconnect"}
					</Button>
				</div>
				<div className="flex items-center justify-between pt-2 border-t border-emerald-500/10">
					<span className="text-xs text-muted-foreground">Browser wallet</span>
					<ConnectWallet />
				</div>
			</div>
		);
	}

	return (
		<div className="rounded-lg border border-border bg-card px-4 py-3 space-y-3">
			<div className="flex items-start gap-2 text-xs text-amber-400">
				<AlertTriangle className="size-3.5 mt-0.5 shrink-0" />
				<span>
					Enter your private key to connect the backend trading client. The key is sent to the bot server and used to
					sign on-chain transactions.
				</span>
			</div>
			<div className="flex gap-2">
				<input
					type="password"
					value={privateKey}
					onChange={(e) => setPrivateKey(e.target.value)}
					onKeyDown={(e) => {
						if (e.key === "Enter") handleConnect();
					}}
					placeholder="Private key (0x...)"
					className="flex-1 h-8 rounded-md border border-border bg-background px-3 text-xs font-mono placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
					autoComplete="off"
					spellCheck={false}
				/>
				<Button
					size="sm"
					className="h-8 px-4 text-xs"
					onClick={handleConnect}
					disabled={!privateKey.trim() || liveConnect.isPending}
				>
					<Wallet className="size-3" />
					{liveConnect.isPending ? "Connecting..." : "Connect"}
				</Button>
			</div>
			{liveConnect.isError && (
				<p className="text-xs text-red-400">Failed to connect: {liveConnect.error?.message ?? "Unknown error"}</p>
			)}
			{liveConnect.data && !liveConnect.data.ok && (
				<p className="text-xs text-red-400">{liveConnect.data.error ?? "Connection failed"}</p>
			)}
			<div className="flex items-center justify-between pt-2 border-t border-border/50">
				<span className="text-xs text-muted-foreground">Browser wallet</span>
				<ConnectWallet />
			</div>
		</div>
	);
}
