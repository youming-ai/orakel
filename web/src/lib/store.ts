import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { ViewMode } from "./types";

export type AnalyticsTab = "overview" | "trades" | "strategy";

/* ── UI state ─────────────────────────────────────────── */

interface UIState {
	/** Current dashboard view: paper or live trading */
	viewMode: ViewMode;
	setViewMode: (mode: ViewMode) => void;

	/** Confirmation dialog state for start/stop actions */
	confirmAction: "start" | "stop" | null;
	setConfirmAction: (action: "start" | "stop" | null) => void;

	/** UI color theme */
	theme: "light" | "dark";
	toggleTheme: () => void;

	/** Active analytics tab */
	analyticsTab: AnalyticsTab;
	setAnalyticsTab: (tab: AnalyticsTab) => void;
}

export const useUIStore = create<UIState>()(
	persist(
		(set) => ({
			viewMode: "paper",
			setViewMode: (mode) => set({ viewMode: mode }),

			confirmAction: null,
			setConfirmAction: (action) => set({ confirmAction: action }),

			analyticsTab: "overview",
			setAnalyticsTab: (tab) => set({ analyticsTab: tab }),

			theme: "dark",
			toggleTheme: () =>
				set((state) => {
					const next = state.theme === "dark" ? "light" : "dark";
					document.documentElement.classList.toggle("dark", next === "dark");
					return { theme: next };
				}),
		}),
		{
			name: "orakel-ui",
			partialize: (state) => ({ viewMode: state.viewMode, theme: state.theme, analyticsTab: state.analyticsTab }),
		},
	),
);
