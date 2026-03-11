import { cva } from "class-variance-authority";

// ---------------------------------------------------------------------------
// Side badge — UP/DOWN tinted background (trade tables)
// ---------------------------------------------------------------------------

export const sideBadge = cva("", {
	variants: {
		side: {
			up: "bg-emerald-500/15 text-emerald-400",
			down: "bg-red-500/15 text-red-400",
		},
	},
});

// ---------------------------------------------------------------------------
// Mode badge — PAPER / LIVE (trade tables)
// ---------------------------------------------------------------------------

export const modeBadge = cva("", {
	variants: {
		mode: {
			paper: "bg-amber-500/15 text-amber-400 border-amber-500/30",
			live: "bg-blue-500/15 text-blue-400 border-blue-500/30",
		},
	},
});
