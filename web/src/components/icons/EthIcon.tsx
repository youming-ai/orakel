import { cn } from "@/lib/utils";

interface EthIconProps {
	className?: string;
	size?: number;
}

export function EthIcon({ className, size = 16 }: EthIconProps) {
	return (
		<span
			className={cn("inline-block overflow-hidden", className)}
			style={{ borderRadius: 120, width: size, height: size }}
		>
			<img
				src="https://s2.coinmarketcap.com/static/img/coins/64x64/1027.png"
				alt="ETH"
				width={size}
				height={size}
				loading="lazy"
			/>
		</span>
	);
}
