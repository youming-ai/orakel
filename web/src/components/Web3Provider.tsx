import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { fallback, http, createConfig, WagmiProvider } from "wagmi";
import { polygon } from "wagmi/chains";
import { injected } from "wagmi/connectors";

const config = createConfig({
	chains: [polygon],
	connectors: [injected()],
	transports: {
		[polygon.id]: fallback([http("https://polygon-bor-rpc.publicnode.com"), http("https://rpc.ankr.com/polygon")]),
	},
	ssr: false,
});

const queryClient = new QueryClient({
	defaultOptions: {
		queries: {
			refetchOnWindowFocus: false,
			retry: 1,
		},
	},
});

export function Web3Provider({ children }: { children: ReactNode }) {
	return (
		<WagmiProvider config={config}>
			<QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
		</WagmiProvider>
	);
}
