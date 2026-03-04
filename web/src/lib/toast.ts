import { create } from "zustand";
import { TOAST_AUTO_DISMISS_MS } from "./constants";

interface ToastMessage {
	id: string;
	title?: string;
	description: string;
	type: "success" | "error" | "info";
	exiting: boolean;
}

interface ToastStore {
	toasts: ToastMessage[];
	toast: (props: Omit<ToastMessage, "id" | "exiting">) => void;
	dismiss: (id: string) => void;
}

export const useToastStore = create<ToastStore>((set) => ({
	toasts: [],
	toast: (props) => {
		const id = Math.random().toString(36).slice(2, 9);
		set((state) => ({
			toasts: [...state.toasts, { ...props, id, exiting: false }],
		}));
		// Auto dismiss with exit animation
		setTimeout(() => {
			set((state) => ({
				toasts: state.toasts.map((t) => (t.id === id ? { ...t, exiting: true } : t)),
			}));
			// Remove after exit animation completes (200ms)
			setTimeout(() => {
				set((state) => ({
					toasts: state.toasts.filter((t) => t.id !== id),
				}));
			}, 200);
		}, TOAST_AUTO_DISMISS_MS);
	},
	dismiss: (id) => {
		set((state) => ({
			toasts: state.toasts.map((t) => (t.id === id ? { ...t, exiting: true } : t)),
		}));
		// Remove after exit animation completes (200ms)
		setTimeout(() => {
			set((state) => ({
				toasts: state.toasts.filter((t) => t.id !== id),
			}));
		}, 200);
	},
}));

export function toast(props: Omit<ToastMessage, "id" | "exiting"> | string) {
	if (typeof props === "string") {
		useToastStore.getState().toast({ description: props, type: "info" });
	} else {
		useToastStore.getState().toast(props);
	}
}
