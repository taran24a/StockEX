import type { Pool } from "pg";
import { afterEach, describe, expect, it, vi } from "vitest";
import { eventBus } from "../events/bus.js";
import { quoteCache } from "../market/quote-cache.js";
import { SimulationControls } from "./simulation-controls.js";
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

  it("pauses scheduled feed polling and resumes it on administrator control", async () => {
    const fetchMock = vi.fn(async () => new Response(
      JSON.stringify({ quotes: [quote] }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    ));
    vi.stubGlobal("fetch", fetchMock);
    const controls = new SimulationControls();
    const query = vi.fn().mockResolvedValue({ rows: [], rowCount: 1 });
    const stop = startPriceTicker({ query } as unknown as Pool, "http://feed.test", 15, controls);

    try {
      await vi.waitFor(() => expect(fetchMock).toHaveBeenCalled());
      await vi.waitFor(() => expect(quoteCache.get("ALFA")).toEqual(quote));
      controls.setRunning("ticker", false);
      const callsWhilePaused = fetchMock.mock.calls.length;
      await new Promise((resolve) => setTimeout(resolve, 45));
      expect(fetchMock).toHaveBeenCalledTimes(callsWhilePaused);

      controls.setRunning("ticker", true);
      await vi.waitFor(() => expect(fetchMock.mock.calls.length).toBeGreaterThan(callsWhilePaused));
    } finally {
      stop();
    }
  });
});
