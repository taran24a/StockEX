import { describe, expect, it } from "vitest";
import { QuotesResponseSchema } from "@tradewise/shared";
import { advanceQuotes, initialQuotes } from "./market.js";

describe("synthetic mock quote feed", () => {
  it("provides a valid initial quote set with integer paise prices", () => {
    const quotes = initialQuotes(new Date("2026-01-01T00:00:00.000Z"));

    expect(QuotesResponseSchema.parse({ quotes })).toEqual({ quotes });
    expect(quotes.length).toBeGreaterThan(0);
    expect(quotes.every((quote) => Number.isSafeInteger(quote.pricePaise))).toBe(true);
  });

  it("advances prices using the supplied random source", () => {
    const initial = initialQuotes(new Date("2026-01-01T00:00:00.000Z"));
    const next = advanceQuotes(initial, () => 1, new Date("2026-01-01T00:00:01.000Z"));

    expect(next[0]?.pricePaise).toBeGreaterThan(initial[0]?.pricePaise ?? 0);
    expect(next[0]?.changePaise).toBeGreaterThan(0);
    expect(next[0]?.updatedAt).toBe("2026-01-01T00:00:01.000Z");
    expect(QuotesResponseSchema.parse({ quotes: next })).toEqual({ quotes: next });
  });
});
