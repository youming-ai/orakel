import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { ViewMode } from "./types";

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
}

export const useUIStore = create<UIState>()(
	persist(
		(set) => ({
			viewMode: "paper",
			setViewMode: (mode) => set({ viewMode: mode }),

			confirmAction: null,
			setConfirmAction: (action) => set({ confirmAction: action }),

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
			partialize: (state) => ({ viewMode: state.viewMode, theme: state.theme }),
		},
	),
);
