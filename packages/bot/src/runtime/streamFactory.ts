import type { MarketConfig } from "../core/configTypes.ts";
import { startMultiBinanceTradeStream } from "../data/binanceWs.ts";
import { startChainlinkPriceStream } from "../data/chainlinkWs.ts";
import type { ClobWsHandle } from "../data/polymarketClobWs.ts";
import { startClobMarketWs } from "../data/polymarketClobWs.ts";
import { startMultiPolymarketPriceStream } from "../data/polymarketLiveWs.ts";
import type { StreamHandles, WsStreamHandle } from "../trading/tradeTypes.ts";

interface MarketStreamBundle {
	streams: StreamHandles;
	clobWs: ClobWsHandle;
}

export function createMarketStreams(markets: MarketConfig[]): MarketStreamBundle {
	const spotSymbols = [...new Set(markets.map((market) => market.spotSymbol))];
	const polymarketSymbols = [...new Set(markets.map((market) => market.chainlink.wsSymbol))];

	const streams: StreamHandles = {
		spot: startMultiBinanceTradeStream(spotSymbols),
		polymarket: startMultiPolymarketPriceStream(polymarketSymbols),
		chainlink: new Map<string, WsStreamHandle>(),
	};

	const chainlinkStreamCache = new Map<string, WsStreamHandle>();
	for (const market of markets) {
		const key = market.chainlink.aggregator;
		let stream = chainlinkStreamCache.get(key);
		if (!stream) {
			stream = startChainlinkPriceStream({
				aggregator: market.chainlink.aggregator,
				decimals: market.chainlink.decimals,
			});
			chainlinkStreamCache.set(key, stream);
		}
		streams.chainlink.set(market.id, stream);
	}

	return {
		streams,
		clobWs: startClobMarketWs(),
	};
}
