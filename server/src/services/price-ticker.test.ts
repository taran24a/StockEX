import type { Pool } from "pg";
import { afterEach, describe, expect, it, vi } from "vitest";
import { eventBus } from "../events/bus.js";
import { quoteCache } from "../market/quote-cache.js";
import { startPriceTicker } from "./price-ticker.js";

const quote = {
  symbol: "ALFA",
  name: "Alfa Compute Systems",
  pricePaise: 12_500_000,
  changePaise: 0,
  updatedAt: "2026-01-01T00:00:00.000Z"
};

afterEach(() => {
  vi.unstubAllGlobals();
  quoteCache.clear();
});

describe("price ticker", () => {
  it("persists feed prices, caches quotes, and emits typed quote events", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(
      JSON.stringify({ quotes: [quote] }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    )));
    const query = vi.fn().mockResolvedValue({ rows: [], rowCount: 1 });
    const pool = { query } as unknown as Pool;
    const onQuote = vi.fn();
    eventBus.on("quote", onQuote);
    const stop = startPriceTicker(pool, "http://feed.test", 60_000);

    try {
      await vi.waitFor(() => {
        expect(query).toHaveBeenCalledOnce();
        expect(onQuote).toHaveBeenCalledWith(quote);
      });
      expect(quoteCache.get("ALFA")).toEqual(quote);
      expect(query.mock.calls[0]?.[1]).toEqual([
        ["ALFA"],
        [12_500_000],
        ["2026-01-01T00:00:00.000Z"]
      ]);
    } finally {
      stop();
      eventBus.off("quote", onQuote);
    }
  });
});
