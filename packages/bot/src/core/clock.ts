import type { Phase } from "./types.ts";

const ET_TIMEZONE = "America/New_York";

function getEtTime(nowMs: number): {
	year: number;
	month: number;
	day: number;
	hour: number;
	minute: number;
	second: number;
} {
	const date = new Date(nowMs);
	const etFormatter = new Intl.DateTimeFormat("en-US", {
		timeZone: ET_TIMEZONE,
		year: "numeric",
		month: "numeric",
		day: "numeric",
		hour: "numeric",
		minute: "numeric",
		second: "numeric",
		hour12: false,
	});
	const parts = etFormatter.formatToParts(date);
	const getPart = (type: string) => Number.parseInt(parts.find((p) => p.type === type)?.value ?? "0", 10);

	return {
		year: getPart("year"),
		month: getPart("month"),
		day: getPart("day"),
		hour: getPart("hour"),
		minute: getPart("minute"),
		second: getPart("second"),
	};
}

function etToUtcTimestamp(
	year: number,
	month: number,
	day: number,
	hour: number,
	minute: number,
	second: number,
): number {
	const etDateStr = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}T${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}:${String(second).padStart(2, "0")}-04:00`;
	return Math.floor(new Date(etDateStr).getTime() / 1000);
}

export function computeWindowBounds(nowSec: number, windowSec: number): { startSec: number; endSec: number } {
	const nowMs = nowSec * 1000;
	const etNow = getEtTime(nowMs);

	const currentMinuteOfDay = etNow.hour * 60 + etNow.minute;
	const windowMinutes = windowSec / 60;

	const currentWindowIndex = Math.floor(currentMinuteOfDay / windowMinutes);
	const nextWindowIndex = currentWindowIndex + 1;

	const startMinuteOfDay = currentWindowIndex * windowMinutes;
	const endMinuteOfDay = nextWindowIndex * windowMinutes;

	const startHour = Math.floor(startMinuteOfDay / 60);
	const startMin = startMinuteOfDay % 60;
	let endHour = Math.floor(endMinuteOfDay / 60);
	const endMin = endMinuteOfDay % 60;

	const startDay = etNow.day;
	let endDay = etNow.day;
	const startMonth = etNow.month;
	const endMonth = etNow.month;
	const startYear = etNow.year;
	const endYear = etNow.year;

	if (endHour >= 24) {
		endHour = 0;
		endDay++;
	}

	const startSec = etToUtcTimestamp(startYear, startMonth, startDay, startHour, startMin, 0);
	const endSec = etToUtcTimestamp(endYear, endMonth, endDay, endHour, endMin, 0);

	return { startSec, endSec };
}

export function computeSlug(epochSec: number, slugPrefix: string): string {
	const sep = slugPrefix.endsWith("-") ? "" : "-";
	return `${slugPrefix}${sep}${epochSec}`;
}

export function computeTimeLeftSeconds(nowMs: number, endMs: number): number {
	return Math.max(0, Math.round((endMs - nowMs) / 1000));
}

export function computePhase(timeLeftSeconds: number, phaseEarlySeconds: number, phaseLateSeconds: number): Phase {
	if (timeLeftSeconds > phaseEarlySeconds) return "EARLY";
	if (timeLeftSeconds <= phaseLateSeconds) return "LATE";
	return "MID";
}
