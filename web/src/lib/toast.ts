import { create } from "zustand";

export interface ToastMessage {
    id: string;
    title?: string;
    description: string;
    type: "success" | "error" | "info";
}

interface ToastStore {
    toasts: ToastMessage[];
    toast: (props: Omit<ToastMessage, "id">) => void;
    dismiss: (id: string) => void;
}

export const useToastStore = create<ToastStore>((set) => ({
    toasts: [],
    toast: (props) => {
        const id = Math.random().toString(36).slice(2, 9);
        set((state) => ({
            toasts: [...state.toasts, { ...props, id }],
        }));
        // Auto dismiss
        setTimeout(() => {
            set((state) => ({
                toasts: state.toasts.filter((t) => t.id !== id),
            }));
        }, 3500);
    },
    dismiss: (id) =>
        set((state) => ({
            toasts: state.toasts.filter((t) => t.id !== id),
        })),
}));

export function toast(props: Omit<ToastMessage, "id"> | string) {
    if (typeof props === "string") {
        useToastStore.getState().toast({ description: props, type: "info" });
    } else {
        useToastStore.getState().toast(props);
    }
}
