import type { Pool } from "pg";
import { eventBus } from "../events/bus.js";
import { logger } from "../logger.js";
import { fetchMarketPrices } from "../market/feed-client.js";
import { quoteCache } from "../market/quote-cache.js";

export function startPriceTicker(pool: Pool, feedUrl: string, intervalMs = 1_000): () => void {
  let stopped = false;
  let polling = false;

  const tick = async (): Promise<void> => {
    if (stopped || polling) {
      return;
    }
    polling = true;
    try {
      const quotes = await fetchMarketPrices(feedUrl);
      if (quotes.length > 0) {
        await pool.query(
          `UPDATE instruments AS instrument
           SET last_price = feed.price, updated_at = feed.updated_at
           FROM unnest($1::text[], $2::numeric[], $3::timestamptz[]) AS feed(symbol, price, updated_at)
           WHERE instrument.symbol = feed.symbol`,
          [
            quotes.map((quote) => quote.symbol),
            quotes.map((quote) => quote.pricePaise),
            quotes.map((quote) => quote.updatedAt)
          ]
        );
      }
      quoteCache.setMany(quotes);
      for (const quote of quotes) {
        eventBus.emit("quote", quote);
      }
    } catch (error) {
      logger.error({ err: error }, "Price ticker update failed");
    } finally {
      polling = false;
    }
  };

  const timer = setInterval(() => {
    void tick();
  }, intervalMs);
  void tick();

  return () => {
    stopped = true;
    clearInterval(timer);
  };
}
