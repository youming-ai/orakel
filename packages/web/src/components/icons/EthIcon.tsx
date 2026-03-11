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
				src="https://polymarket.com/_next/image?url=https%3A%2F%2Fpolymarket-upload.s3.us-east-2.amazonaws.com%2FETH%2Bfullsize.jpg&w=256&q=75"
				alt="ETH"
				width={size}
				height={size}
				loading="lazy"
			/>
		</span>
	);
}
