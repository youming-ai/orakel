import { useEffect, useState } from "react";

const STORAGE_KEY = "orakel_pixel_theme";
const CLASS_NAME = "pixel-theme";

export interface UsePixelThemeReturn {
	readonly isPixel: boolean;
	readonly togglePixel: () => void;
}

/**
 * Hook to manage pixel theme preference.
 * Persists to localStorage and applies .pixel-theme class to document root.
 */
export function usePixelTheme(): UsePixelThemeReturn {
	const [isPixel, setIsPixel] = useState<boolean>(() => {
		if (typeof window === "undefined") {
			return false;
		}
		try {
			const stored = localStorage.getItem(STORAGE_KEY);
			return stored === "true";
		} catch {
			return false;
		}
	});

	useEffect(() => {
		if (typeof window === "undefined") {
			return;
		}
		const root = document.documentElement;
		if (isPixel) {
			root.classList.add(CLASS_NAME);
		} else {
			root.classList.remove(CLASS_NAME);
		}
	}, [isPixel]);

	const togglePixel = () => {
		setIsPixel((previous) => {
			const next = !previous;
			try {
				localStorage.setItem(STORAGE_KEY, String(next));
			} catch {
				// Silently fail if localStorage is unavailable
			}
			return next;
		});
	};

	return {
		isPixel,
		togglePixel,
	};
}
