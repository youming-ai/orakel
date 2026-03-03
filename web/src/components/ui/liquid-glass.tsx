import { cn } from "@/lib/utils";
import { forwardRef, type HTMLAttributes } from "react";

/**
 * Liquid Glass (Glassmorphism) Card Component
 *
 * Features:
 * - Semi-transparent background with blur
 * - Subtle border with gradient
 * - Soft inner shadow for depth
 * - Noise texture overlay for realism
 * - Hover effects with enhanced glow
 */
export const LiquidGlassCard = forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement>>(
	({ className, children, ...props }, ref) => {
		return (
			<div
				ref={ref}
				className={cn(
					// Base glass effect
					"relative overflow-hidden rounded-xl",
					// Semi-transparent background
					"bg-white/5 dark:bg-black/40",
					// Backdrop blur for glass effect
					"backdrop-blur-xl backdrop-saturate-150",
					// Subtle border with gradient
					"border border-white/10 dark:border-white/5",
					// Inner shadow for depth
					"before:absolute before:inset-0 before:rounded-xl",
					"before:bg-gradient-to-br before:from-white/20 before:to-transparent before:opacity-50",
					"before:shadow-[inset_0_1px_1px_rgba(255,255,255,0.1)]",
					// Outer shadow
					"shadow-lg shadow-black/5 dark:shadow-black/20",
					// Subtle noise texture
					"after:absolute after:inset-0 after:rounded-xl after:opacity-[0.03]",
					"after:bg-[url('data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSI0IiBoZWlnaHQ9IjQiPgo8cmVjdCB3aWR0aD0iNCIgaGVpZ2h0PSI0IiBmaWxsPSIjZmZmIi8+CjxyZWN0IHdpZHRoPSIxIiBoZWlnaHQ9IjEiIGZpbGw9IiMwMDAiLz4KPC9zdmc+')]",
					// Smooth transitions
					"transition-all duration-300 ease-out",
					// Hover effects
					"hover:bg-white/10 dark:hover:bg-black/50",
					"hover:border-white/20 dark:hover:border-white/10",
					"hover:shadow-xl hover:shadow-black/10 dark:hover:shadow-black/30",
					className,
				)}
				{...props}
			>
				{children}
			</div>
		);
	},
);

LiquidGlassCard.displayName = "LiquidGlassCard";

/**
 * Liquid Glass Button Component
 */
export const LiquidGlassButton = forwardRef<HTMLButtonElement, HTMLAttributes<HTMLButtonElement>>(
	({ className, children, ...props }, ref) => {
		return (
			<button
				ref={ref}
				className={cn(
					"relative overflow-hidden rounded-lg px-4 py-2 font-medium",
					// Glass background
					"bg-white/10 dark:bg-white/5",
					"backdrop-blur-md",
					// Border
					"border border-white/20 dark:border-white/10",
					// Inner glow effect
					"before:absolute before:inset-0 before:rounded-lg",
					"before:bg-gradient-to-r before:from-white/20 before:via-white/5 before:to-white/20",
					// Shine effect on hover
					"after:absolute after:inset-0 after:rounded-lg",
					"after:bg-gradient-to-r after:from-transparent after:via-white/20 after:to-transparent",
					"after:translate-x-[-100%] after:transition-transform after:duration-700",
					// Transitions
					"transition-all duration-200",
					"hover:bg-white/15 dark:hover:bg-white/10",
					"hover:border-white/30 dark:hover:border-white/20",
					"hover:shadow-lg hover:shadow-white/10",
					"hover:after:translate-x-[100%]",
					"active:scale-95",
					className,
				)}
				{...props}
			>
				<span className="relative z-10">{children}</span>
			</button>
		);
	},
);

LiquidGlassButton.displayName = "LiquidGlassButton";

/**
 * Liquid Glass Badge Component
 */
export const LiquidGlassBadge = forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement>>(
	({ className, children, ...props }, ref) => {
		return (
			<div
				ref={ref}
				className={cn(
					"inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium",
					// Glass effect
					"bg-white/10 dark:bg-white/5",
					"backdrop-blur-md",
					// Border
					"border border-white/20 dark:border-white/10",
					// Shadow
					"shadow-sm",
					className,
				)}
				{...props}
			>
				{children}
			</div>
		);
	},
);

LiquidGlassBadge.displayName = "LiquidGlassBadge";

/**
 * Liquid Glass Panel (for larger sections)
 */
export const LiquidGlassPanel = forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement>>(
	({ className, children, ...props }, ref) => {
		return (
			<div
				ref={ref}
				className={cn(
					"relative overflow-hidden rounded-2xl",
					// Enhanced glass for larger panels
					"bg-white/[0.08] dark:bg-black/[0.5]",
					"backdrop-blur-2xl backdrop-saturate-200",
					// Gradient border effect
					"border border-white/15 dark:border-white/5",
					// Multiple shadow layers
					"shadow-2xl shadow-black/10 dark:shadow-black/40",
					// Animated gradient border on hover
					"before:absolute before:inset-0 before:rounded-2xl before:p-[1px]",
					"before:bg-gradient-to-br before:from-white/30 before:via-white/10 before:to-transparent",
					"before:-z-10 before:opacity-50 before:transition-opacity before:duration-500",
					"hover:before:opacity-100",
					className,
				)}
				{...props}
			>
				{/* Animated gradient mesh background */}
				<div className="absolute inset-0 -z-20 opacity-20 dark:opacity-10">
					<div className="absolute inset-0 bg-gradient-to-br from-blue-500/20 via-purple-500/20 to-pink-500/20 animate-pulse" />
					<div className="absolute inset-0 bg-gradient-to-tr from-emerald-500/20 via-cyan-500/20 to-blue-500/20 animate-pulse delay-1000" />
				</div>
				{children}
			</div>
		);
	},
);

LiquidGlassPanel.displayName = "LiquidGlassPanel";
