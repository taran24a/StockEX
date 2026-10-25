import type { Pool } from "pg";
import { describe, expect, it, vi } from "vitest";
import {
  calculatePortfolioInsight,
  deterministicPortfolioExplanation,
  numericOnlyInsightInput
} from "./portfolio-insight.js";

function portfolioPool(): Pool {
  const query = vi.fn((sql: string) => {
    if (sql.includes("FROM accounts AS account")) {
      return Promise.resolve({ rows: [{ id: "account-1", cash_balance: "90000000", contributed_capital: "100000000" }] });
    }
    if (sql.includes("FROM positions AS position")) {
      return Promise.resolve({
        rows: [{
          symbol: "NOVA",
          quantity: 2,
          avg_cost: "10000000",
          last_price: "11000000",
          previous_close: "10500000"
        }]
      });
    }
    return Promise.resolve({ rows: [{ realized_pnl: "500000" }] });
  });
  return { query } as unknown as Pool;
}

describe("portfolio insight", () => {
  it("computes account metrics and per-holding contributions from database values", async () => {
    const metrics = await calculatePortfolioInsight(portfolioPool(), "user-1");
    expect(metrics).toEqual({
      totalEquityPaise: 112_000_000,
      cashBalancePaise: 90_000_000,
      contributedCapitalPaise: 100_000_000,
      returnPct: 12,
      realizedPnlPaise: 500_000,
      unrealizedPnlPaise: 2_000_000,
      dayChangePaise: 1_000_000,
      holdings: [{
        symbol: "NOVA",
        marketValuePaise: 22_000_000,
        unrealizedPnlPaise: 2_000_000,
        dayChangeContributionPaise: 1_000_000
      }]
    });
  });

  it("sends numbers and holding indices, never symbols, to the model boundary", async () => {
    const metrics = await calculatePortfolioInsight(portfolioPool(), "user-1");
    const modelInput = numericOnlyInsightInput(metrics);
    expect(JSON.stringify(modelInput)).not.toContain("NOVA");
    expect(modelInput).toMatchObject({
      totalEquityPaise: 112_000_000,
      holdings: [{ index: 1, marketValuePaise: 22_000_000 }]
    });
  });

  it("creates a deterministic summary when no model is used", async () => {
    const metrics = await calculatePortfolioInsight(portfolioPool(), "user-1");
    const fallback = deterministicPortfolioExplanation(metrics);
    expect(fallback.explanation).toContain("12.00%");
    expect(fallback.explanation).toContain("not trading advice");
    expect(fallback.highlights).toHaveLength(4);
  });
});
