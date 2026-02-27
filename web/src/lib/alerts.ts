import { useEffect } from "react";
import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { SignalNewData, TradeExecutedData, WsMessage } from "./ws.ts";
import { subscribeGlobal } from "./ws.ts";

/* ── Alert Types ─────────────────────────────────────────── */

export interface Alert {
	id: string;
	type: "signal" | "trade" | "warning";
	marketId: string;
	title: string;
	description: string;
	timestamp: number;
	data?: Record<string, unknown>;
}

export interface AlertPreferences {
	enableSignalAlerts: boolean;
	enableTradeAlerts: boolean;
	enableBrowserNotifications: boolean;
	minProbability: number;
	minEdge: number;
	autoDismissMs: number;
}

/* ── Alert Store ─────────────────────────────────────────── */

interface AlertState {
	/** Active alerts displayed in overlay */
	alerts: Alert[];
	/** Historical alerts (up to 100) */
	history: Alert[];
	/** User preferences for alert behavior */
	preferences: AlertPreferences;
	/** Add a new alert */
	addAlert: (alert: Omit<Alert, "id" | "timestamp">) => void;
	/** Dismiss an active alert */
	dismissAlert: (id: string) => void;
	/** Clear all active alerts */
	clearAlerts: () => void;
	/** Clear alert history */
	clearHistory: () => void;
	/** Update alert preferences */
	updatePreferences: (prefs: Partial<AlertPreferences>) => void;
	/** Request browser notification permission */
	requestNotificationPermission: () => Promise<boolean>;
	/** Show browser notification */
	showBrowserNotification: (title: string, body: string) => void;
}

const DEFAULT_PREFERENCES: AlertPreferences = {
	enableSignalAlerts: true,
	enableTradeAlerts: true,
	enableBrowserNotifications: false,
	minProbability: 0.55,
	minEdge: 0.05,
	autoDismissMs: 10000,
};

function generateId(): string {
	return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

export const useAlertStore = create<AlertState>()(
	persist(
		(set, get) => ({
			alerts: [],
			history: [],
			preferences: DEFAULT_PREFERENCES,

			addAlert: (alertData) => {
				const id = generateId();
				const timestamp = Date.now();
				const newAlert: Alert = {
					...alertData,
					id,
					timestamp,
				};

				set((state) => {
					// Add to active alerts
					const alerts = [...state.alerts, newAlert];

					// Add to history (keep last 100)
					const history = [newAlert, ...state.history].slice(0, 100);

					return { alerts, history };
				});

				// Auto-dismiss after configured time
				const { autoDismissMs } = get().preferences;
				setTimeout(() => {
					get().dismissAlert(id);
				}, autoDismissMs);
			},

			dismissAlert: (id) => {
				set((state) => ({
					alerts: state.alerts.filter((a) => a.id !== id),
				}));
			},

			clearAlerts: () => {
				set({ alerts: [] });
			},

			clearHistory: () => {
				set({ history: [] });
			},

			updatePreferences: (prefs) => {
				set((state) => ({
					preferences: { ...state.preferences, ...prefs },
				}));
			},

			requestNotificationPermission: async () => {
				if (!("Notification" in window)) {
					return false;
				}

				if (Notification.permission === "granted") {
					return true;
				}

				if (Notification.permission === "denied") {
					return false;
				}

				const permission = await Notification.requestPermission();
				return permission === "granted";
			},

			showBrowserNotification: (title, body) => {
				const { preferences } = get();
				if (!preferences.enableBrowserNotifications) return;
				if (!("Notification" in window)) return;
				if (Notification.permission !== "granted") return;

				new Notification(title, {
					body,
					icon: "/favicon.ico",
					tag: "orakel-alert",
					requireInteraction: false,
				});
			},
		}),
		{
			name: "orakel-alerts",
			partialize: (state) => ({
				preferences: state.preferences,
				history: state.history.slice(0, 100),
			}),
		},
	),
);

/* ── Helper hook for filtered alerts ─────────────────────── */

export function useFilteredHistory(typeFilter?: "signal" | "trade" | "warning" | "all") {
	const history = useAlertStore((s) => s.history);

	if (!typeFilter || typeFilter === "all") {
		return history;
	}

	return history.filter((a) => a.type === typeFilter);
}

/* ── Alert Handler Hook ─────────────────────────────────── */

/**
 * Hook that subscribes to WebSocket messages and creates alerts
 * for signal:new and trade:executed events based on user preferences.
 */
export function useAlertHandler() {
	const preferences = useAlertStore((s) => s.preferences);
	const addAlert = useAlertStore((s) => s.addAlert);
	const showBrowserNotification = useAlertStore((s) => s.showBrowserNotification);

	useEffect(() => {
		const handler = (msg: WsMessage) => {
			// Handle signal:new events
			if (msg.type === "signal:new" && preferences.enableSignalAlerts) {
				const data = msg.data as SignalNewData;

				// Check thresholds
				if (data.edge >= preferences.minEdge && data.probability >= preferences.minProbability) {
					const title = `Signal: ${data.direction}`;
					const description = `Edge: ${(data.edge * 100).toFixed(1)}%, Prob: ${(data.probability * 100).toFixed(1)}%`;

					addAlert({
						type: "signal",
						marketId: data.marketId,
						title,
						description,
						data: { ...data },
					});

					showBrowserNotification(`Signal: ${data.marketId}`, `${data.direction} - ${description}`);
				}
			}

			// Handle trade:executed events
			if (msg.type === "trade:executed" && preferences.enableTradeAlerts) {
				const data = msg.data as TradeExecutedData;

				const title = `Trade: ${data.side}`;
				const description = `Size: ${data.size.toFixed(2)} @ ${data.price.toFixed(4)}`;

				addAlert({
					type: "trade",
					marketId: data.marketId,
					title,
					description,
					data: { ...data },
				});

				showBrowserNotification(`Trade: ${data.marketId}`, `${data.side} - ${description}`);
			}
		};

		// Subscribe to global WebSocket messages
		const unsubscribe = subscribeGlobal(handler);
		return unsubscribe;
	}, [preferences, addAlert, showBrowserNotification]);
}
