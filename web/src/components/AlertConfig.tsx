import { Bell, BellOff, Check, X } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useAlertStore } from "@/lib/alerts";
import { toast } from "@/lib/toast";
import { cn } from "@/lib/utils";

/* ── Toggle Switch ───────────────────────────────────────── */

interface ToggleSwitchProps {
	checked: boolean;
	onChange: (checked: boolean) => void;
	disabled?: boolean;
	label: string;
}

function ToggleSwitch({ checked, onChange, disabled, label }: ToggleSwitchProps) {
	return (
		<button
			type="button"
			role="switch"
			aria-checked={checked}
			aria-label={label}
			disabled={disabled}
			onClick={() => onChange(!checked)}
			className={cn(
				"relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out",
				"focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
				checked ? "bg-primary" : "bg-muted",
				disabled && "opacity-50 cursor-not-allowed",
			)}
		>
			<span
				className={cn(
					"pointer-events-none inline-block h-4 w-4 transform rounded-full bg-background shadow ring-0 transition duration-200 ease-in-out",
					checked ? "translate-x-4" : "translate-x-0",
				)}
			/>
		</button>
	);
}

/* ── Number Input ────────────────────────────────────────── */

interface NumberInputProps {
	value: number;
	onChange: (value: number) => void;
	min: number;
	max: number;
	step: number;
	label: string;
	suffix?: string;
}

function NumberInput({ value, onChange, min, max, step, label, suffix }: NumberInputProps) {
	return (
		<div className="flex items-center gap-2">
			<input
				type="number"
				value={value}
				onChange={(e) => {
					const val = Number.parseFloat(e.target.value);
					if (!Number.isNaN(val)) {
						onChange(Math.min(max, Math.max(min, val)));
					}
				}}
				min={min}
				max={max}
				step={step}
				aria-label={label}
				className="w-20 h-8 px-2 text-sm rounded-md border border-input bg-background text-foreground text-center tabular-nums focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
			/>
			{suffix && <span className="text-xs text-muted-foreground">{suffix}</span>}
		</div>
	);
}

/* ── Alert Config ─────────────────────────────────────────── */

export function AlertConfig() {
	const preferences = useAlertStore((s) => s.preferences);
	const updatePreferences = useAlertStore((s) => s.updatePreferences);
	const requestNotificationPermission = useAlertStore((s) => s.requestNotificationPermission);

	const [notificationStatus, setNotificationStatus] = useState<"granted" | "denied" | "default">("default");

	// Check notification permission on mount
	useEffect(() => {
		if ("Notification" in window) {
			setNotificationStatus(Notification.permission);
		}
	}, []);

	const handleBrowserNotificationsToggle = useCallback(
		async (enabled: boolean) => {
			if (enabled) {
				const granted = await requestNotificationPermission();
				if (granted) {
					updatePreferences({ enableBrowserNotifications: true });
					setNotificationStatus("granted");
					toast({ type: "success", description: "Browser notifications enabled" });
				} else {
					setNotificationStatus(Notification.permission);
					toast({ type: "error", description: "Notification permission denied" });
				}
			} else {
				updatePreferences({ enableBrowserNotifications: false });
			}
		},
		[requestNotificationPermission, updatePreferences],
	);

	const canEnableNotifications = notificationStatus !== "denied";
	const notificationDenied = notificationStatus === "denied";

	return (
		<Card>
			<CardHeader className="pb-3">
				<CardTitle className="text-base flex items-center gap-2">
					<Bell className="size-4" />
					Alert Settings
				</CardTitle>
				<CardDescription>Configure how you receive trading alerts and notifications</CardDescription>
			</CardHeader>
			<CardContent className="space-y-4">
				{/* Signal Alerts */}
				<div className="flex items-center justify-between py-2">
					<div className="space-y-0.5">
						<p className="text-sm font-medium">Signal Alerts</p>
						<p className="text-xs text-muted-foreground">Notify on new trading signals</p>
					</div>
					<ToggleSwitch
						checked={preferences.enableSignalAlerts}
						onChange={(checked) => updatePreferences({ enableSignalAlerts: checked })}
						label="Enable signal alerts"
					/>
				</div>

				{/* Trade Alerts */}
				<div className="flex items-center justify-between py-2">
					<div className="space-y-0.5">
						<p className="text-sm font-medium">Trade Alerts</p>
						<p className="text-xs text-muted-foreground">Notify when trades are executed</p>
					</div>
					<ToggleSwitch
						checked={preferences.enableTradeAlerts}
						onChange={(checked) => updatePreferences({ enableTradeAlerts: checked })}
						label="Enable trade alerts"
					/>
				</div>

				{/* Browser Notifications */}
				<div className="flex items-center justify-between py-2">
					<div className="space-y-0.5">
						<div className="flex items-center gap-2">
							<p className="text-sm font-medium">Browser Notifications</p>
							{notificationDenied && (
								<span className="text-[10px] px-1.5 py-0.5 rounded bg-red-500/20 text-red-400 flex items-center gap-1">
									<X className="size-2.5" />
									Blocked
								</span>
							)}
							{preferences.enableBrowserNotifications && notificationStatus === "granted" && (
								<span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-500/20 text-emerald-400 flex items-center gap-1">
									<Check className="size-2.5" />
									Active
								</span>
							)}
						</div>
						<p className="text-xs text-muted-foreground">
							{notificationDenied ? "Permission denied. Enable in browser settings." : "Show desktop notifications"}
						</p>
					</div>
					<ToggleSwitch
						checked={preferences.enableBrowserNotifications && notificationStatus === "granted"}
						onChange={handleBrowserNotificationsToggle}
						disabled={notificationDenied}
						label="Enable browser notifications"
					/>
				</div>

				{/* Thresholds */}
				<div className="pt-3 border-t border-border">
					<p className="text-sm font-medium mb-3">Alert Thresholds</p>
					<div className="grid grid-cols-2 gap-4">
						<div className="flex items-center justify-between">
							<span className="text-xs text-muted-foreground">Min Probability</span>
							<NumberInput
								value={preferences.minProbability}
								onChange={(val) => updatePreferences({ minProbability: val })}
								min={0.5}
								max={1}
								step={0.01}
								label="Minimum probability"
							/>
						</div>
						<div className="flex items-center justify-between">
							<span className="text-xs text-muted-foreground">Min Edge</span>
							<NumberInput
								value={preferences.minEdge}
								onChange={(val) => updatePreferences({ minEdge: val })}
								min={0}
								max={0.5}
								step={0.01}
								label="Minimum edge"
							/>
						</div>
					</div>
				</div>

				{/* Auto-dismiss */}
				<div className="pt-3 border-t border-border">
					<div className="flex items-center justify-between">
						<div className="space-y-0.5">
							<p className="text-sm font-medium">Auto-dismiss</p>
							<p className="text-xs text-muted-foreground">Time before alerts disappear</p>
						</div>
						<NumberInput
							value={preferences.autoDismissMs / 1000}
							onChange={(val) => updatePreferences({ autoDismissMs: val * 1000 })}
							min={3}
							max={60}
							step={1}
							label="Auto-dismiss seconds"
							suffix="sec"
						/>
					</div>
				</div>
			</CardContent>
		</Card>
	);
}
