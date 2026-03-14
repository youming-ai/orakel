import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { ViewMode } from "./types";

type Theme = "light" | "dark";

function getSystemTheme(): Theme {
	if (typeof window === "undefined") return "light";
	return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function applyTheme(theme: Theme) {
	if (theme === "dark") {
		document.documentElement.classList.add("dark");
	} else {
		document.documentElement.classList.remove("dark");
	}
}

interface UIState {
	viewMode: ViewMode;
	setViewMode: (mode: ViewMode) => void;

	confirmAction: "start" | "stop" | null;
	setConfirmAction: (action: "start" | "stop" | null) => void;

	theme: Theme;
	setTheme: (theme: Theme) => void;
	toggleTheme: () => void;
}

export const useUIStore = create<UIState>()(
	persist(
		(set, get) => ({
			viewMode: "paper",
			setViewMode: (mode) => set({ viewMode: mode }),

			confirmAction: null,
			setConfirmAction: (action) => set({ confirmAction: action }),

			theme: getSystemTheme(),
			setTheme: (theme) => {
				set({ theme });
				applyTheme(theme);
			},
			toggleTheme: () => {
				const newTheme = get().theme === "light" ? "dark" : "light";
				set({ theme: newTheme });
				applyTheme(newTheme);
			},
		}),
		{
			name: "orakel-ui",
			partialize: (state) => ({ viewMode: state.viewMode, theme: state.theme }),
			onRehydrateStorage: () => {
				return (state) => {
					if (state) {
						applyTheme(state.theme);
					}
				};
			},
		},
	),
);
