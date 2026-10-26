import express from "express";
import type { Pool } from "pg";
import request from "supertest";
import { afterEach, describe, expect, it, vi } from "vitest";
import { errorHandler } from "../middleware/error-handler.js";
import { quoteCache } from "../market/quote-cache.js";
import { createMarketRouter } from "./market.js";

afterEach(() => {
  vi.unstubAllGlobals();
  quoteCache.clear();
});

function marketApp(pool: Pool) {
  const app = express();
  app.use("/market", createMarketRouter(pool, "http://feed.test"));
  app.use(errorHandler);
  return app;
}

describe("market candle route", () => {
  it("returns searchable instrument data with matching live quotes", async () => {
    const id = "e246e1cb-8d22-4e59-b139-8fbaf801874d";
    const quote = {
      symbol: "ALFA",
      name: "Alfa Industries",
      pricePaise: 12_500,
      changePaise: 100,
      updatedAt: "2026-01-01T00:00:00.000Z"
    };
    quoteCache.set(quote);
    const query = vi.fn().mockResolvedValue({
      rows: [{
        id,
        symbol: "ALFA",
        name: "Alfa Industries",
        sector: "Technology",
        tick_size: "1",
        last_price: "12500",
        created_at: new Date("2026-01-01T00:00:00.000Z"),
        updated_at: new Date("2026-01-01T00:00:00.000Z")
      }]
    });

    const response = await request(marketApp({ query } as unknown as Pool)).get("/market/instruments");

    expect(response.status).toBe(200);
    expect(response.body.instruments).toEqual([{
      instrument: {
        id,
        symbol: "ALFA",
        name: "Alfa Industries",
        sector: "Technology",
        tickSizePaise: 1,
        lastPricePaise: 12_500,
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z"
      },
      quote
    }]);
  });

  it("returns aggregated public depth for open limit orders only", async () => {
    const query = vi.fn().mockResolvedValue({
      rows: [
        { side: "buy", price_paise: "12500", quantity: "4", order_count: "2" },
        { side: "sell", price_paise: "12700", quantity: "2", order_count: "1" },
        { side: "buy", price_paise: "12600", quantity: "1", order_count: "1" },
        { side: "sell", price_paise: "12600", quantity: "3", order_count: "1" }
      ]
    });

    const response = await request(marketApp({ query } as unknown as Pool)).get("/market/ALFA/depth");

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      bids: [
        { pricePaise: 12600, quantity: 1, orderCount: 1 },
        { pricePaise: 12500, quantity: 4, orderCount: 2 }
      ],
      asks: [
        { pricePaise: 12600, quantity: 3, orderCount: 1 },
        { pricePaise: 12700, quantity: 2, orderCount: 1 }
      ]
    });
    expect(query.mock.calls[0]?.[1]).toEqual(["ALFA"]);
    expect(query.mock.calls[0]?.[0]).toContain("orders.status IN ('open', 'partially_filled')");
  });

  it("rejects invalid query parameters before querying the database", async () => {
    const query = vi.fn();
    const response = await request(marketApp({ query } as unknown as Pool))
      .get("/market/ALFA/candles?interval=invalid&limit=1001");

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe("VALIDATION_ERROR");
    expect(query).not.toHaveBeenCalled();
  });

  it("returns candles for a valid interval and limit", async () => {
    const query = vi.fn()
      .mockResolvedValueOnce({ rows: [{ id: "e246e1cb-8d22-4e59-b139-8fbaf801874d" }] })
      .mockResolvedValueOnce({
        rows: [{
          instrument_id: "e246e1cb-8d22-4e59-b139-8fbaf801874d",
          ts: new Date("2026-01-01T00:00:00.000Z"),
          open: "100",
          high: "120",
          low: "90",
          close: "110",
          volume: "500"
        }]
      });

    const response = await request(marketApp({ query } as unknown as Pool))
      .get("/market/ALFA/candles?interval=1d&limit=10");

    expect(response.status).toBe(200);
    expect(response.body.candles).toEqual([{
      instrumentId: "e246e1cb-8d22-4e59-b139-8fbaf801874d",
      ts: "2026-01-01T00:00:00.000Z",
      openPaise: 100,
      highPaise: 120,
      lowPaise: 90,
      closePaise: 110,
      volume: 500
    }]);
    expect(query).toHaveBeenCalledTimes(2);
    expect(query.mock.calls[1]?.[1]).toEqual([
      "e246e1cb-8d22-4e59-b139-8fbaf801874d",
      "1 day",
      10,
      true
    ]);
  });
});
