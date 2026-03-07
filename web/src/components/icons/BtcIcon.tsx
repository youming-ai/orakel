import { cn } from "@/lib/utils";

interface BtcIconProps {
	className?: string;
	size?: number;
}

export function BtcIcon({ className, size = 16 }: BtcIconProps) {
	return (
		<span
			className={cn("inline-block overflow-hidden", className)}
			style={{ borderRadius: 120, width: size, height: size }}
		>
			<img
				src="https://s2.coinmarketcap.com/static/img/coins/64x64/1.gif"
				alt="BTC"
				width={size}
				height={size}
				loading="lazy"
			/>
		</span>
	);
}
