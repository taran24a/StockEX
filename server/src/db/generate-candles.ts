import { mkdir } from "node:fs/promises";
import { createWriteStream } from "node:fs";
import { dirname, resolve } from "node:path";
import { once } from "node:events";
import { marketInstruments } from "../feed/market.js";

const outputPath = resolve(process.argv[2] ?? "data/candles.csv");
await mkdir(dirname(outputPath), { recursive: true });
const output = createWriteStream(outputPath, { encoding: "utf8" });
const today = new Date();
today.setUTCHours(0, 0, 0, 0);

function randomInteger(max: number): number {
  return Math.floor(Math.random() * (max + 1));
}

async function writeLine(line: string): Promise<void> {
  if (!output.write(`${line}\n`)) {
    await once(output, "drain");
  }
}

await writeLine("symbol,ts,open,high,low,close,volume");

for (const instrument of marketInstruments) {
  let previousClose: number = instrument.initialPricePaise;
  for (let daysAgo = 89; daysAgo >= 0; daysAgo -= 1) {
    const timestamp = new Date(today);
    timestamp.setUTCDate(today.getUTCDate() - daysAgo);
    const open = previousClose;
    const movementBps = randomInteger(400) - 200;
    const close = Math.max(1, open + Number(BigInt(open) * BigInt(movementBps) / 10_000n));
    const high = Math.max(open, close) + randomInteger(Math.max(1, Math.floor(open / 200)));
    const low = Math.max(1, Math.min(open, close) - randomInteger(Math.max(1, Math.floor(open / 200))));
    await writeLine([
      instrument.symbol,
      timestamp.toISOString(),
      open,
      high,
      low,
      close,
      randomInteger(1_000_000)
    ].join(","));
    previousClose = close;
  }
}

output.end();
await once(output, "finish");
console.info(`Generated 1,350 synthetic daily candles at ${outputPath}`);
