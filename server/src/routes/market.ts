import { Router } from "express";
import {
  CandleSchema,
  CandlesQuerySchema,
  CandlesResponseSchema,
  MarketDepthResponseSchema,
  MarketInstrumentsResponseSchema,
  InstrumentSchema,
  MarketInstrumentResponseSchema,
  QuoteSchema,
  QuotesResponseSchema
} from "@tradewise/shared";
import type { CandlesQuery } from "@tradewise/shared";
import type { Pool } from "pg";
import { databaseInteger } from "../db/values.js";
import { validateParams, validateQuery, validatedParams, validatedQuery } from "../http-validation.js";
import { fetchMarketPrices } from "../market/feed-client.js";
import { quoteCache } from "../market/quote-cache.js";
import { ApiError } from "../services/errors.js";
import { z } from "zod";

const SymbolParamsSchema = z.object({
  symbol: z.string().regex(/^[A-Z][A-Z0-9.-]{0,31}$/)
});
const intervalSql = {
  "1m": "1 minute",
  "5m": "5 minutes",
  "15m": "15 minutes",
  "1h": "1 hour",
  "4h": "4 hours",
  "1d": "1 day"
} as const;

interface InstrumentRow {
  id: string;
  symbol: string;
  name: string;
  sector: string;
  tick_size: string | number;
  last_price: string | number;
  created_at: Date;
  updated_at: Date;
}

interface CandleRow {
  instrument_id: string;
  ts: Date;
  open: string | number;
  high: string | number;
  low: string | number;
  close: string | number;
  volume: string | number;
}

interface MarketDepthRow {
  side: "buy" | "sell";
  price_paise: string | number;
  quantity: string | number;
  order_count: string | number;
}

export function createMarketRouter(pool: Pool, feedUrl: string): Router {
  const router = Router();

  router.get("/instruments", async (_request, response) => {
    let quotes = quoteCache.getAll();
    if (quotes === undefined) {
      quotes = await fetchMarketPrices(feedUrl);
      quoteCache.setMany(quotes);
    }
    const quotesBySymbol = new Map(quotes.map((quote) => [quote.symbol, quote]));
    const result = await pool.query<InstrumentRow>(
      `SELECT id, symbol, name, sector, tick_size, last_price, created_at, updated_at
       FROM instruments ORDER BY symbol`
    );
    response.json(MarketInstrumentsResponseSchema.parse({
      instruments: result.rows.map((row) => ({
        instrument: InstrumentSchema.parse({
          id: row.id,
          symbol: row.symbol,
          name: row.name,
          sector: row.sector,
          tickSizePaise: databaseInteger(row.tick_size, "instrument tick size"),
          lastPricePaise: databaseInteger(row.last_price, "instrument last price"),
          createdAt: row.created_at.toISOString(),
          updatedAt: row.updated_at.toISOString()
        }),
        quote: quotesBySymbol.get(row.symbol) ?? null
      }))
    }));
  });

  router.get("/quotes", async (_request, response) => {
    let quotes = quoteCache.getAll();
    if (quotes === undefined) {
      quotes = await fetchMarketPrices(feedUrl);
      quoteCache.setMany(quotes);
    }
    response.json(QuotesResponseSchema.parse({ quotes }));
  });

  router.get("/:symbol/candles", validateParams(SymbolParamsSchema), validateQuery(CandlesQuerySchema), async (_request, response) => {
    const { symbol } = validatedParams<z.infer<typeof SymbolParamsSchema>>(response);
    const { interval, limit } = validatedQuery<CandlesQuery>(response);
    const instrument = await pool.query<{ id: string }>(
      "SELECT id FROM instruments WHERE symbol = $1",
      [symbol]
    );
    const instrumentId = instrument.rows[0]?.id;
    if (instrumentId === undefined) {
      throw new ApiError(404, "INSTRUMENT_NOT_FOUND", `Instrument ${symbol} was not found`);
    }

    const result = await pool.query<CandleRow>(
      `WITH buckets AS (
         SELECT date_bin($2::interval, ts, TIMESTAMPTZ '2000-01-01') AS ts,
                (array_agg(open ORDER BY ts))[1] AS open,
                MAX(high) AS high,
                MIN(low) AS low,
                (array_agg(close ORDER BY ts DESC))[1] AS close,
                SUM(volume) AS volume
         FROM candles
         WHERE instrument_id = $1
         GROUP BY 1
         ORDER BY 1 DESC
         LIMIT $3
       )
       SELECT $1::uuid AS instrument_id, ts, open, high, low, close, volume
       FROM buckets
       ORDER BY ts ASC`,
      [instrumentId, intervalSql[interval], limit]
    );
    const candles = result.rows.map((row) => CandleSchema.parse({
      instrumentId: row.instrument_id,
      ts: row.ts.toISOString(),
      openPaise: databaseInteger(row.open, "candle open"),
      highPaise: databaseInteger(row.high, "candle high"),
      lowPaise: databaseInteger(row.low, "candle low"),
      closePaise: databaseInteger(row.close, "candle close"),
      volume: databaseInteger(row.volume, "candle volume")
    }));
    response.json(CandlesResponseSchema.parse({ candles }));
  });

  router.get("/:symbol/depth", validateParams(SymbolParamsSchema), async (_request, response) => {
    const { symbol } = validatedParams<z.infer<typeof SymbolParamsSchema>>(response);
    const result = await pool.query<MarketDepthRow>(
      `SELECT orders.side, orders.limit_price AS price_paise,
              SUM(orders.quantity - orders.filled_quantity) AS quantity,
              COUNT(*) AS order_count
       FROM orders
       JOIN instruments ON instruments.id = orders.instrument_id
       WHERE instruments.symbol = $1
         AND orders.type = 'limit'
         AND orders.status IN ('open', 'partially_filled')
       GROUP BY orders.side, orders.limit_price`,
      [symbol]
    );
    const levels = result.rows.map((row) => ({
      side: row.side,
      pricePaise: databaseInteger(row.price_paise, "order book price"),
      quantity: databaseInteger(row.quantity, "order book quantity"),
      orderCount: databaseInteger(row.order_count, "order book order count")
    }));
    response.json(MarketDepthResponseSchema.parse({
      bids: levels.filter((level) => level.side === "buy").sort((a, b) => b.pricePaise - a.pricePaise),
      asks: levels.filter((level) => level.side === "sell").sort((a, b) => a.pricePaise - b.pricePaise)
    }));
  });

  router.get("/:symbol", validateParams(SymbolParamsSchema), async (_request, response) => {
    const { symbol } = validatedParams<z.infer<typeof SymbolParamsSchema>>(response);
    const result = await pool.query<InstrumentRow>(
      `SELECT id, symbol, name, sector, tick_size, last_price, created_at, updated_at
       FROM instruments WHERE symbol = $1`,
      [symbol]
    );
    const row = result.rows[0];
    if (row === undefined) {
      throw new ApiError(404, "INSTRUMENT_NOT_FOUND", `Instrument ${symbol} was not found`);
    }
    const instrument = InstrumentSchema.parse({
      id: row.id,
      symbol: row.symbol,
      name: row.name,
      sector: row.sector,
      tickSizePaise: databaseInteger(row.tick_size, "instrument tick size"),
      lastPricePaise: databaseInteger(row.last_price, "instrument last price"),
      createdAt: row.created_at.toISOString(),
      updatedAt: row.updated_at.toISOString()
    });
    let quote = quoteCache.get(symbol);
    if (quote === undefined) {
      const feedQuotes = await fetchMarketPrices(feedUrl);
      quoteCache.setMany(feedQuotes);
      quote = feedQuotes.find((item) => item.symbol === symbol);
    }
    response.json(MarketInstrumentResponseSchema.parse({
      instrument,
      quote: quote === undefined ? null : QuoteSchema.parse(quote)
    }));
  });

  return router;
}
