import type { Quote } from "@tradewise/shared";

export class QuoteCache {
  private entries = new Map<string, { quote: Quote; expiresAt: number }>();

  constructor(private readonly ttlMs = 1_000) {
    if (!Number.isSafeInteger(ttlMs) || ttlMs < 1) {
      throw new RangeError("Quote cache TTL must be a positive integer");
    }
  }

  get(symbol: string, now = Date.now()): Quote | undefined {
    const entry = this.entries.get(symbol);
    if (entry === undefined) {
      return undefined;
    }
    if (entry.expiresAt <= now) {
      this.entries.delete(symbol);
      return undefined;
    }
    return entry.quote;
  }

  getAll(now = Date.now()): Quote[] | undefined {
    const values = [...this.entries.keys()].map((symbol) => this.get(symbol, now));
    const quotes = values.filter((quote): quote is Quote => quote !== undefined);
    return quotes.length === 0 ? undefined : quotes;
  }

  set(quote: Quote, now = Date.now()): void {
    this.entries.set(quote.symbol, { quote, expiresAt: now + this.ttlMs });
  }

  setMany(quotes: readonly Quote[], now = Date.now()): void {
    for (const quote of quotes) {
      this.set(quote, now);
    }
  }

  clear(): void {
    this.entries.clear();
  }
}

export const quoteCache = new QuoteCache();
