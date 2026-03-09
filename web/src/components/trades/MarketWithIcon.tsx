import { BtcIcon, EthIcon } from "@/components/icons";

export function MarketWithIcon({ market, slug }: { market: string; slug: string | null }) {
	const isBtc = market.startsWith("BTC");
	const isEth = market.startsWith("ETH");
	const displayText = slug || market;
	return (
		<span className="flex items-center gap-1.5">
			{isBtc && <BtcIcon size={14} />}
			{isEth && <EthIcon size={14} />}
			<span>{displayText}</span>
		</span>
	);
}
