import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { usePixelTheme } from "../usePixelTheme.ts";

const STORAGE_KEY = "orakel_pixel_theme";
const CLASS_NAME = "pixel-theme";

describe("usePixelTheme", () => {
	beforeEach(() => {
		// Clear localStorage before each test
		localStorage.clear();
		// Clear documentElement classes
		document.documentElement.classList.remove(CLASS_NAME);
	});

	afterEach(() => {
		// Cleanup after each test
		localStorage.clear();
		document.documentElement.classList.remove(CLASS_NAME);
	});

	describe("initialization", () => {
		it("should initialize with false when localStorage is empty", () => {
			const { result } = renderHook(() => usePixelTheme());

			expect(result.current.isPixel).toBe(false);
			expect(document.documentElement.classList.contains(CLASS_NAME)).toBe(false);
		});

		it("should initialize with true when localStorage has 'true'", () => {
			localStorage.setItem(STORAGE_KEY, "true");

			const { result } = renderHook(() => usePixelTheme());

			expect(result.current.isPixel).toBe(true);
			expect(document.documentElement.classList.contains(CLASS_NAME)).toBe(true);
		});

		it("should initialize with false when localStorage has 'false'", () => {
			localStorage.setItem(STORAGE_KEY, "false");

			const { result } = renderHook(() => usePixelTheme());

			expect(result.current.isPixel).toBe(false);
			expect(document.documentElement.classList.contains(CLASS_NAME)).toBe(false);
		});

		it("should initialize with false when localStorage has invalid value", () => {
			localStorage.setItem(STORAGE_KEY, "invalid");

			const { result } = renderHook(() => usePixelTheme());

			expect(result.current.isPixel).toBe(false);
			expect(document.documentElement.classList.contains(CLASS_NAME)).toBe(false);
		});

		it("should handle localStorage unavailability gracefully", () => {
			// Mock localStorage.getItem to throw
			const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
			const originalGetItem = Storage.prototype.getItem;
			vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
				throw new Error("localStorage unavailable");
			});

			const { result } = renderHook(() => usePixelTheme());

			expect(result.current.isPixel).toBe(false);

			// Cleanup
			consoleSpy.mockRestore();
			Storage.prototype.getItem = originalGetItem;
		});
	});

	describe("DOM class manipulation", () => {
		it("should add pixel-theme class when isPixel is true", () => {
			localStorage.setItem(STORAGE_KEY, "true");
			renderHook(() => usePixelTheme());

			expect(document.documentElement.classList.contains(CLASS_NAME)).toBe(true);
		});

		it("should remove pixel-theme class when isPixel is false", () => {
			localStorage.setItem(STORAGE_KEY, "false");
			renderHook(() => usePixelTheme());

			expect(document.documentElement.classList.contains(CLASS_NAME)).toBe(false);
		});
	});

	describe("togglePixel function", () => {
		it("should toggle from false to true and update class", () => {
			const { result } = renderHook(() => usePixelTheme());

			expect(result.current.isPixel).toBe(false);
			expect(document.documentElement.classList.contains(CLASS_NAME)).toBe(false);

			act(() => {
				result.current.togglePixel();
			});

			expect(result.current.isPixel).toBe(true);
			expect(localStorage.getItem(STORAGE_KEY)).toBe("true");
			expect(document.documentElement.classList.contains(CLASS_NAME)).toBe(true);
		});

		it("should toggle from true to false and remove class", () => {
			localStorage.setItem(STORAGE_KEY, "true");
			const { result } = renderHook(() => usePixelTheme());

			expect(result.current.isPixel).toBe(true);
			expect(document.documentElement.classList.contains(CLASS_NAME)).toBe(true);

			act(() => {
				result.current.togglePixel();
			});

			expect(result.current.isPixel).toBe(false);
			expect(localStorage.getItem(STORAGE_KEY)).toBe("false");
			expect(document.documentElement.classList.contains(CLASS_NAME)).toBe(false);
		});

		it("should toggle multiple times correctly", () => {
			const { result } = renderHook(() => usePixelTheme());

			// Initial state
			expect(result.current.isPixel).toBe(false);

			// First toggle: false -> true
			act(() => {
				result.current.togglePixel();
			});
			expect(result.current.isPixel).toBe(true);
			expect(localStorage.getItem(STORAGE_KEY)).toBe("true");

			// Second toggle: true -> false
			act(() => {
				result.current.togglePixel();
			});
			expect(result.current.isPixel).toBe(false);
			expect(localStorage.getItem(STORAGE_KEY)).toBe("false");

			// Third toggle: false -> true
			act(() => {
				result.current.togglePixel();
			});
			expect(result.current.isPixel).toBe(true);
			expect(localStorage.getItem(STORAGE_KEY)).toBe("true");
		});
	});

	describe("localStorage persistence", () => {
		it("should persist theme preference to localStorage when toggling to true", () => {
			const { result } = renderHook(() => usePixelTheme());

			act(() => {
				result.current.togglePixel();
			});

			expect(localStorage.getItem(STORAGE_KEY)).toBe("true");
		});

		it("should persist theme preference to localStorage when toggling to false", () => {
			localStorage.setItem(STORAGE_KEY, "true");
			const { result } = renderHook(() => usePixelTheme());

			act(() => {
				result.current.togglePixel();
			});

			expect(localStorage.getItem(STORAGE_KEY)).toBe("false");
		});

		it("should not throw error when localStorage is unavailable during toggle", () => {
			const { result } = renderHook(() => usePixelTheme());

			// Mock localStorage.setItem to throw
			const originalSetItem = Storage.prototype.setItem;
			vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
				throw new Error("localStorage unavailable");
			});

			expect(() => {
				act(() => {
					result.current.togglePixel();
				});
			}).not.toThrow();

			// Restore original
			Storage.prototype.setItem = originalSetItem;
		});
	});

	describe("TypeScript interface", () => {
		it("should return correct interface structure", () => {
			const { result } = renderHook(() => usePixelTheme());

			expect(result.current).toHaveProperty("isPixel");
			expect(result.current).toHaveProperty("togglePixel");
			expect(typeof result.current.isPixel).toBe("boolean");
			expect(typeof result.current.togglePixel).toBe("function");
		});
	});
});
