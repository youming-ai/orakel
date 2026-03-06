import { Navigate, Route, Routes } from "react-router";
import { AppLayout, type LayoutProps } from "@/app/layout/AppLayout";
import { Dashboard } from "@/pages/Dashboard";
import { TradesPage } from "@/pages/Trades";

interface AppRouterProps {
	layoutProps: LayoutProps;
}

export function AppRouter({ layoutProps }: AppRouterProps) {
	return (
		<Routes>
			<Route path="/" element={<AppLayout {...layoutProps} />}>
				<Route index element={<Dashboard />} />
				<Route path="logs" element={<TradesPage />} />
				<Route path="*" element={<Navigate to="/" replace />} />
			</Route>
		</Routes>
	);
}
