import express from "express";
import request from "supertest";
import { afterEach, describe, expect, it, vi } from "vitest";
import { QuotesResponseSchema } from "@tradewise/shared";
import { errorHandler } from "../middleware/error-handler.js";
import { createQuotesRouter } from "./quotes.js";

afterEach(() => {
  vi.unstubAllGlobals();
});

function quotesApp() {
  const app = express();
  app.use("/quotes", createQuotesRouter("http://feed.test"));
  app.use(errorHandler);
  return app;
}

describe("GET /quotes", () => {
  it("fetches and validates quote data from the feed service", async () => {
    const payload = {
      quotes: [{
        symbol: "ALFA",
        name: "Alfa Industries",
        pricePaise: 1_234,
        changePaise: -10,
        updatedAt: "2026-01-01T00:00:00.000Z"
      }]
    };
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(payload), { status: 200 })));

    const response = await request(quotesApp()).get("/quotes");

    expect(response.status).toBe(200);
    expect(QuotesResponseSchema.parse(response.body)).toEqual(payload);
  });

  it("returns a service error when the feed responds unsuccessfully", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("", { status: 503 })));

    const response = await request(quotesApp()).get("/quotes");

    expect(response.status).toBe(502);
    expect(response.body.error.code).toBe("MARKET_FEED_ERROR");
  });
});
