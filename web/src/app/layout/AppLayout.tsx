import { Outlet } from "react-router";
import { Header } from "@/components/Header";

export interface LayoutProps {
	viewMode: "paper" | "live";
	paperRunning: boolean;
	liveRunning: boolean;
	paperPendingStart: boolean;
	paperPendingStop: boolean;
	livePendingStart: boolean;
	livePendingStop: boolean;
	paperMutationPending: boolean;
	liveMutationPending: boolean;
	onViewModeChange: (mode: "paper" | "live") => void;
	onPaperToggle: () => void;
	onLiveToggle: () => void;
}

export function AppLayout(props: LayoutProps) {
	return (
		<div className="min-h-screen bg-background">
			<Header {...props} />
			<Outlet />
		</div>
	);
}
