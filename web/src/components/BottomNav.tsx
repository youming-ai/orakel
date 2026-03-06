import { LayoutDashboard, ScrollText } from "lucide-react";
import { Link, useLocation } from "react-router";

import { cn } from "@/lib/utils";

const tabs = [
	{
		label: "Dashboard",
		icon: LayoutDashboard,
		to: "/",
	},
	{
		label: "Trades",
		icon: ScrollText,
		to: "/logs",
	},
] as const;

export function BottomNav() {
	const location = useLocation();

	return (
		<nav className="fixed bottom-0 left-0 right-0 z-50 border-t border-border bg-card pb-safe sm:hidden">
			<div className="flex h-14 items-stretch px-safe">
				{tabs.map((tab) => {
					const Icon = tab.icon;
					const isActive = location.pathname === tab.to;

					return (
						<Link
							key={tab.to}
							to={tab.to}
							className={cn(
								"flex flex-1 flex-col items-center justify-center gap-1 no-underline transition-colors",
								isActive ? "text-primary" : "text-muted-foreground",
							)}
							aria-current={isActive ? "page" : undefined}
						>
							<Icon className="size-4" />
							<span className="text-[11px] font-medium leading-none">{tab.label}</span>
						</Link>
					);
				})}
			</div>
		</nav>
	);
}
