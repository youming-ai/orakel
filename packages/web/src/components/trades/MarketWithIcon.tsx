import { BtcIcon } from "@/components/icons";

const DISPLAY_NAMES: Record<string, string> = {
	"BTC-5m": "Bitcoin Up or Down — 5 Min",
};

export function MarketWithIcon({ market, slug }: { market: string; slug: string | null }) {
	const isBtc = market.startsWith("BTC");
	const displayText = slug || DISPLAY_NAMES[market] || market;
	return (
		<span className="flex items-center gap-1.5">
			{isBtc && <BtcIcon size={14} />}
			<span>{displayText}</span>
		</span>
	);
}
