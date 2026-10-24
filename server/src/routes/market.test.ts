import express from "express";
import type { Pool } from "pg";
import request from "supertest";
import { afterEach, describe, expect, it, vi } from "vitest";
import { errorHandler } from "../middleware/error-handler.js";
import { createMarketRouter } from "./market.js";

afterEach(() => {
  vi.unstubAllGlobals();
});

function marketApp(pool: Pool) {
  const app = express();
  app.use("/market", createMarketRouter(pool, "http://feed.test"));
  app.use(errorHandler);
  return app;
}

describe("market candle route", () => {
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
      10
    ]);
  });
});
