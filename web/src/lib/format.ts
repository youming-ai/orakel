/** Format timestamp to HH:MM:SS */
export function fmtTime(ts: string): string {
	const d = new Date(ts);
	if (Number.isNaN(d.getTime())) return "-";
	return d.toLocaleTimeString("en-US", { hour12: false, hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

/** Format timestamp to HH:MM (no seconds) */
export function fmtTimeShort(ts: string): string {
	const d = new Date(ts);
	if (Number.isNaN(d.getTime())) return "-";
	return d.toLocaleTimeString("en-US", { hour12: false, hour: "2-digit", minute: "2-digit" });
}

/** Format timestamp to MM/DD HH:MM:SS */
export function fmtDateTime(ts: string): string {
	const d = new Date(ts);
	if (Number.isNaN(d.getTime())) return "-";
	return d.toLocaleString("en-US", {
		hour12: false,
		month: "2-digit",
		day: "2-digit",
		hour: "2-digit",
		minute: "2-digit",
		second: "2-digit",
	});
}

/** Format timestamp to MM/DD */
export function fmtDate(ts: string): string {
	if (!ts) return "";
	const d = new Date(ts);
	if (Number.isNaN(d.getTime())) return "";
	return d.toLocaleDateString("en-US", { month: "2-digit", day: "2-digit" });
}

/** Format price based on market id */
export function fmtPrice(id: string, price: number | null): string {
	if (price === null) return "---";
	if (id === "BTC") return `$${price.toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
	if (id === "ETH") return `$${price.toLocaleString("en-US", { minimumFractionDigits: 1, maximumFractionDigits: 1 })}`;
	if (id === "SOL") return `$${price.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
	return `$${price.toLocaleString("en-US", { minimumFractionDigits: 4, maximumFractionDigits: 4 })}`;
}

/** Format cents (e.g. 0.65 -> "65c") */
export function fmtCents(v: number | null): string {
	if (v === null) return "---";
	return `${(v * 100).toFixed(0)}c`;
}

/** Format minutes as MM:SS countdown */
export function fmtMinSec(min: number | null): string {
	if (min === null) return "--:--";
	const m = Math.floor(min);
	const s = Math.round((min - m) * 60);
	return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

/** Safely parse unknown value to number */
export function asNumber(value: unknown, fallback = 0): number {
	const n = Number(value);
	return Number.isFinite(n) ? n : fallback;
}
