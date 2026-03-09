import { Navigate, Route, Routes } from "react-router";
import { AppLayout, type LayoutProps } from "@/app/layout/AppLayout";
import { OverviewPanel } from "@/widgets/overview/OverviewPanel";
import { TradesPanel } from "@/widgets/trades/TradesPanel";

interface AppRouterProps {
	layoutProps: LayoutProps;
}

export function AppRouter({ layoutProps }: AppRouterProps) {
	return (
		<Routes>
			<Route path="/" element={<AppLayout {...layoutProps} />}>
				<Route index element={<OverviewPanel />} />
				<Route path="logs" element={<TradesPanel />} />
				<Route path="*" element={<Navigate to="/" replace />} />
			</Route>
		</Routes>
	);
}
