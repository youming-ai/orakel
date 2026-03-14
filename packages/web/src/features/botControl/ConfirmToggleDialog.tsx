import { useCallback } from "react";
import { useDashboardStateWithWs } from "@/app/ws/useDashboardStateWithWs";
import {
	AlertDialog,
	AlertDialogAction,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useLiveToggle, usePaperToggle } from "@/features/botControl/mutations";
import { useUIStore } from "@/lib/store";
import { toast } from "@/lib/toast";

export function ConfirmToggleDialog() {
	const confirmAction = useUIStore((s) => s.confirmAction);
	const confirmBotMode = useUIStore((s) => s.confirmBotMode);
	const setConfirmAction = useUIStore((s) => s.setConfirmAction);
	const { data: state } = useDashboardStateWithWs();
	const paperToggle = usePaperToggle();
	const liveToggle = useLiveToggle();

	const handleConfirm = useCallback(() => {
		if (!state || !confirmAction || !confirmBotMode) return;
		const actionStr = confirmAction === "start" ? "Starting" : "Stopping";
		if (confirmBotMode === "paper") {
			paperToggle.mutate(confirmAction === "stop");
			toast({ title: "Paper Bot", description: `${actionStr} paper trading...`, type: "info" });
		} else {
			liveToggle.mutate(confirmAction === "stop");
			toast({ title: "Live Bot", description: `${actionStr} live trading...`, type: "info" });
		}
		setConfirmAction(null);
	}, [state, confirmAction, confirmBotMode, paperToggle, liveToggle, setConfirmAction]);

	return (
		<AlertDialog
			open={confirmAction !== null}
			onOpenChange={(open) => {
				if (!open) setConfirmAction(null);
			}}
		>
			<AlertDialogContent>
				<AlertDialogHeader>
					<AlertDialogTitle>{confirmAction === "start" ? "Start Bot" : "Stop Bot"}</AlertDialogTitle>
					<AlertDialogDescription>
						{confirmAction === "start"
							? `Start ${confirmBotMode} trading? The bot will begin at the next cycle boundary.`
							: `Stop ${confirmBotMode} trading? The bot will finish the current cycle and settle before stopping.`}
					</AlertDialogDescription>
				</AlertDialogHeader>
				<AlertDialogFooter>
					<AlertDialogCancel>Cancel</AlertDialogCancel>
					<AlertDialogAction onClick={handleConfirm} variant={confirmAction === "stop" ? "destructive" : "default"}>
						{confirmAction === "start" ? "Start" : "Stop"}
					</AlertDialogAction>
				</AlertDialogFooter>
			</AlertDialogContent>
		</AlertDialog>
	);
}
