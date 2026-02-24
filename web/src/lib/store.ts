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
}

export const useUIStore = create<UIState>()(
  persist(
    (set) => ({
      viewMode: "paper",
      setViewMode: (mode) => set({ viewMode: mode }),

      confirmAction: null,
      setConfirmAction: (action) => set({ confirmAction: action }),
    }),
    {
      name: "orakel-ui",
      partialize: (state) => ({ viewMode: state.viewMode }),
    },
  ),
);
