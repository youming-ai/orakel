#!/usr/bin/env node

import fs from "node:fs";

const LOG_DIR = "./logs";
const POLL_MS = 2000;
const COOLDOWN_MS = 60000;

interface SignalPayload {
  marketId?: string;
  marketSlug?: string;
  timestamp?: string;
  side?: "UP" | "DOWN" | string;
  strength?: "STRONG" | "GOOD" | string;
  edgeUp?: number;
  edgeDown?: number;
  modelUp?: number;
  modelDown?: number;
  timeLeftMin?: number;
  phase?: string;
  marketUp?: number | null;
  marketDown?: number | null;
}

const lastPushByMarket: Map<string, { slug: string; time: number }> = new Map();

function listSignalFiles(): string[] {
  try {
    const entries = fs.readdirSync(LOG_DIR);
    return entries
      .filter((name: string) => /^latest-signal-[A-Za-z0-9_-]+\.json$/.test(name))
      .map((name: string) => `${LOG_DIR}/${name}`);
  } catch {
    return [];
  }
}

function checkAndPushFile(filePath: string): void {
  let signal: SignalPayload;
  try {
    signal = JSON.parse(fs.readFileSync(filePath, "utf8")) as SignalPayload;
  } catch {
    return;
  }

  const now = Date.now();
  const marketId = String(signal.marketId || "GLOBAL").toUpperCase();
  const slug = signal.marketSlug || "unknown";
  const prev = lastPushByMarket.get(marketId);
  if (prev && prev.slug === slug && now - prev.time < COOLDOWN_MS) {
    return;
  }

  const signalAge = now - new Date(signal.timestamp ?? 0).getTime();
  if (signalAge > 5000) return;

  lastPushByMarket.set(marketId, { slug, time: now });

  const emoji = signal.side === "UP" ? "🟢" : "🔴";
  const strengthEmoji = signal.strength === "STRONG" ? "💪" : signal.strength === "GOOD" ? "👍" : "🔹";
  const edgeBase = signal.side === "UP" ? signal.edgeUp : signal.edgeDown;
  const edge = Math.abs((edgeBase || 0) * 100).toFixed(1);
  const modelUp = ((signal.modelUp ?? 0) * 100).toFixed(0);
  const modelDown = ((signal.modelDown ?? 0) * 100).toFixed(0);
  const timeLeft = Math.max(0, signal.timeLeftMin ?? 0).toFixed(0);

  const msg = `🚨 **Polymarket Signal!** ${emoji}

**Asset**: ${marketId}
**Side**: BUY ${signal.side}
**Phase**: ${signal.phase} | **Strength**: ${signal.strength} ${strengthEmoji}
**Edge**: +${edge}%
**Model**: UP ${modelUp}% / DOWN ${modelDown}%
**Market**: UP ${signal.marketUp}¢ / DOWN ${signal.marketDown}¢
**Time Left**: ${timeLeft} min

⚡ Place order on Polymarket!`;

  console.log(JSON.stringify({
    type: "DISCORD_PUSH",
    channel: "discord",
    to: "channel:1472992159824220414",
    message: msg
  }));

  try {
    fs.unlinkSync(filePath);
  } catch {}
}

function checkAndPush(): void {
  const files = listSignalFiles();
  for (const filePath of files) {
    checkAndPushFile(filePath);
  }
}

console.error("[notifier] Watching for signals...");
setInterval(checkAndPush, POLL_MS);
