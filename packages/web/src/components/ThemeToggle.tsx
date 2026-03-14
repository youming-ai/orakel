import { Moon, Sun } from "lucide-react";
import { useUIStore } from "@/lib/store";
import { cn } from "@/lib/utils";

export function ThemeToggle() {
	const theme = useUIStore((s) => s.theme);
	const toggleTheme = useUIStore((s) => s.toggleTheme);

	const isDark = theme === "dark";

	return (
		<button
			type="button"
			onClick={toggleTheme}
			aria-label={isDark ? "Switch to light mode" : "Switch to dark mode"}
			title={isDark ? "Switch to light mode" : "Switch to dark mode"}
			className={cn(
				"flex items-center justify-center",
				"size-8 sm:size-7 rounded-md",
				"border bg-background",
				"transition-colors",
				"outline-none focus-visible:ring-2 focus-visible:ring-ring",
				"hover:bg-muted",
			)}
		>
			{isDark ? <Sun className="size-3.5" /> : <Moon className="size-3.5" />}
		</button>
	);
}
