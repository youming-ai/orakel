import { useEffect, useState } from "react";

const QUERY = "(prefers-reduced-motion: reduce)";

/**
 * Hook to detect if the user prefers reduced motion.
 * Returns true if the user has enabled "reduce motion" in their OS settings.
 * Used to disable or reduce animations for accessibility.
 */
export function useReducedMotion(): boolean {
	const [prefersReducedMotion, setPrefersReducedMotion] = useState(() => {
		// Check if window is available (SSR safety)
		if (typeof window === "undefined") {
			return false;
		}
		return window.matchMedia(QUERY).matches;
	});

	useEffect(() => {
		const mediaQuery = window.matchMedia(QUERY);

		// Update state when preference changes
		const handleChange = (event: MediaQueryListEvent) => {
			setPrefersReducedMotion(event.matches);
		};

		// Set initial value
		setPrefersReducedMotion(mediaQuery.matches);

		// Listen for changes
		mediaQuery.addEventListener("change", handleChange);

		return () => {
			mediaQuery.removeEventListener("change", handleChange);
		};
	}, []);

	return prefersReducedMotion;
}
