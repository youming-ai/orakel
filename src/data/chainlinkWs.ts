import { ethers } from "ethers";
import WebSocket from "ws";
import { CONFIG } from "../config.ts";
import { wsAgentForUrl } from "../net/proxy.ts";
import type { PriceTick, WsStreamHandle } from "../types.ts";

const ANSWER_UPDATED_TOPIC0 = "0x0559884fd3a460f71df1384d438bdf1a5ceef8bd81c4d9c4f0a40c5d4b1f0f0a";

interface JsonRpcMessage {
  id?: unknown;
  result?: unknown;
  method?: unknown;
  params?: unknown;
}

function getWssCandidates(): string[] {
  const fromList = Array.isArray(CONFIG.chainlink.polygonWssUrls) ? CONFIG.chainlink.polygonWssUrls : [];
  const single = CONFIG.chainlink.polygonWssUrl ? [CONFIG.chainlink.polygonWssUrl] : [];
  const all = [...fromList, ...single].map((s) => String(s).trim()).filter(Boolean);
  return Array.from(new Set(all));
}

export function hexToSignedBigInt(hex: string): bigint {
  const x = BigInt(hex);
  const TWO_255 = 1n << 255n;
  const TWO_256 = 1n << 256n;
  return x >= TWO_255 ? x - TWO_256 : x;
}

function toNumber(x: unknown): number | null {
  const n = Number(x);
  return Number.isFinite(n) ? n : null;
}

export function startChainlinkPriceStream({
  aggregator = CONFIG.chainlink.btcUsdAggregator,
  decimals = 8,
  onUpdate
}: {
  aggregator?: string;
  decimals?: number;
  onUpdate?: (tick: PriceTick) => void;
} = {}): WsStreamHandle {
  void ethers;

  const wssUrls = getWssCandidates();
  if (!aggregator || wssUrls.length === 0) {
    return {
      getLast(): PriceTick {
        return { price: null, updatedAt: null, source: "chainlink_ws" };
      },
      close(): void {}
    };
  }

  let ws: WebSocket | null = null;
  let closed = false;
  let reconnectMs = 500;
  let urlIndex = 0;

  let lastPrice: number | null = null;
  let lastUpdatedAt: number | null = null;

  let nextId = 1;
  let subId: string | null = null;

  const connect = (): void => {
    if (closed) return;

    const url = wssUrls[urlIndex % wssUrls.length] ?? wssUrls[0];
    if (!url) return;
    urlIndex += 1;

    ws = new WebSocket(url, { agent: wsAgentForUrl(url) });

    const send = (obj: unknown): void => {
      try {
        ws?.send(JSON.stringify(obj));
      } catch {
        return;
      }
    };

    const scheduleReconnect = (): void => {
      if (closed) return;
      try {
        ws?.terminate();
      } catch {
      } finally {
        ws = null;
        subId = null;
      }
      const wait = reconnectMs;
      reconnectMs = Math.min(10_000, Math.floor(reconnectMs * 1.5));
      setTimeout(connect, wait);
    };

    ws.on("open", () => {
      reconnectMs = 500;
      const id = nextId++;
      send({
        jsonrpc: "2.0",
        id,
        method: "eth_subscribe",
        params: [
          "logs",
          {
            address: aggregator,
            topics: [ANSWER_UPDATED_TOPIC0]
          }
        ]
      });
    });

    ws.on("message", (data: WebSocket.RawData) => {
      let msg: JsonRpcMessage;
      try {
        const parsed: unknown = JSON.parse(data.toString());
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return;
        msg = parsed as JsonRpcMessage;
      } catch {
        return;
      }

      if (msg.id && msg.result && typeof msg.result === "string" && !subId) {
        subId = msg.result;
        return;
      }

      if (msg.method !== "eth_subscription") return;
      const params = msg.params;
      if (!params || typeof params !== "object" || Array.isArray(params)) return;
      const paramsResult = "result" in params ? params.result : null;
      if (!paramsResult || typeof paramsResult !== "object" || Array.isArray(paramsResult)) return;

      const log = paramsResult;
      const topics = "topics" in log && Array.isArray(log.topics) ? log.topics : [];
      if (topics.length < 2) return;

      try {
        const answer = hexToSignedBigInt(String(topics[1]));
        const base = toNumber(answer);
        if (base === null) return;
        const price = base / 10 ** Number(decimals);
        const updatedAtHex = "data" in log && typeof log.data === "string" ? log.data : null;
        const updatedAt = updatedAtHex ? toNumber(BigInt(updatedAtHex)) : null;

        lastPrice = Number.isFinite(price) ? price : lastPrice;
        lastUpdatedAt = updatedAt ? updatedAt * 1000 : lastUpdatedAt;

        if (typeof onUpdate === "function") {
          onUpdate({ price: lastPrice, updatedAt: lastUpdatedAt, source: "chainlink_ws" });
        }
      } catch {
        return;
      }
    });

    ws.on("close", () => {
      scheduleReconnect();
    });
    ws.on("error", () => {
      scheduleReconnect();
    });
  };

  connect();

  return {
    getLast(): PriceTick {
      return { price: lastPrice, updatedAt: lastUpdatedAt, source: "chainlink_ws" };
    },
    close(): void {
      closed = true;
      try {
        if (ws && subId) {
          ws.send(JSON.stringify({ jsonrpc: "2.0", id: nextId++, method: "eth_unsubscribe", params: [subId] }));
        }
      } catch {
      }
      try {
        ws?.close();
      } catch {
      } finally {
        ws = null;
        subId = null;
      }
    }
  };
}
