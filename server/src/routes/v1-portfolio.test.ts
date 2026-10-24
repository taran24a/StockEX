import express from "express";
import jwt from "jsonwebtoken";
import type { Pool } from "pg";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";
import { errorHandler } from "../middleware/error-handler.js";
import { createV1PortfolioRouter } from "./v1-portfolio.js";

const secret = "test-secret-long-enough-for-the-portfolio-suite";
const userId = "4b8fbe96-52f4-45b9-a373-195af22bcf22";
const accountId = "ac8fbe96-52f4-45b9-a373-195af22bcf22";
const instrumentId = "bc8fbe96-52f4-45b9-a373-195af22bcf22";

function portfolioApp(query: ReturnType<typeof vi.fn>) {
  const app = express();
  app.use("/api/v1", createV1PortfolioRouter({ query } as unknown as Pool, secret));
  app.use(errorHandler);
  return app;
}

function authorization() {
  const token = jwt.sign({ role: "user" }, secret, { subject: userId, expiresIn: "1h" });
  return { Authorization: `Bearer ${token}` };
}

describe("v1 portfolio routes", () => {
  it("returns cash, reserved cash, marked holdings, and total equity", async () => {
    const query = vi.fn()
      .mockResolvedValueOnce({ rows: [{ id: accountId, cash_balance: "1000", reserved_balance: "200" }] })
      .mockResolvedValueOnce({
        rows: [{
          instrument_id: instrumentId,
          symbol: "ALFA",
          quantity: "5",
          avg_cost: "100",
          last_price: "125",
          previous_close: "115"
        }]
      });

    const response = await request(portfolioApp(query))
      .get("/api/v1/portfolio")
      .set(authorization());

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      accountId,
      cashBalancePaise: 1000,
      reservedBalancePaise: 200,
      holdings: [{
        instrumentId,
        symbol: "ALFA",
        quantity: 5,
        averageCostPaise: 100,
        marketPricePaise: 125,
        marketValuePaise: 625,
        unrealizedPnlPaise: 125
      }],
      totalEquityPaise: 1625
    });
  });

  it("returns realized/unrealized P&L and the ledger-backed equity curve", async () => {
    const query = vi.fn((sql: string) => {
      if (sql.includes("FROM accounts")) {
        return Promise.resolve({ rows: [{ id: accountId, cash_balance: "1000", reserved_balance: "0" }] });
      }
      if (sql.includes("FROM positions")) {
        return Promise.resolve({
          rows: [{
            instrument_id: instrumentId,
            symbol: "ALFA",
            quantity: "2",
            avg_cost: "100",
            last_price: "130",
            previous_close: "120"
          }]
        });
      }
      if (sql.includes("realized_pnl_paise")) {
        return Promise.resolve({ rows: [{ realized_pnl_paise: "-25" }] });
      }
      return Promise.resolve({
        rows: [{ created_at: new Date("2026-10-24T10:00:00.000Z"), equity_after: "1200" }]
      });
    });

    const response = await request(portfolioApp(query))
      .get("/api/v1/portfolio/performance")
      .set(authorization());

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      realizedPnlPaise: -25,
      unrealizedPnlPaise: 60,
      dayChangePaise: 20,
      holdingContributions: [{ symbol: "ALFA", dayChangeContributionPaise: 20 }],
      equityCurve: [{ timestamp: "2026-10-24T10:00:00.000Z", equityPaise: 1200 }]
    });
  });

  it("returns paginated ledger entries scoped to the authenticated account", async () => {
    const query = vi.fn()
      .mockResolvedValueOnce({ rows: [{ id: accountId, cash_balance: "1000", reserved_balance: "0" }] })
      .mockResolvedValueOnce({
        rows: [{
          id: instrumentId,
          account_id: accountId,
          fill_id: null,
          entry_type: "deposit",
          amount: "1000",
          balance_after: "1000",
          created_at: new Date("2026-10-24T10:00:00.000Z")
        }]
      })
      .mockResolvedValueOnce({ rows: [{ total: 1 }] });

    const response = await request(portfolioApp(query))
      .get("/api/v1/ledger?limit=10&offset=5")
      .set(authorization());

    expect(response.status).toBe(200);
    expect(response.body.pagination).toEqual({ limit: 10, offset: 5, total: 1 });
    expect(response.body.entries[0]).toEqual({
      id: instrumentId,
      accountId,
      fillId: null,
      entryType: "deposit",
      amountPaise: 1000,
      balanceAfterPaise: 1000,
      createdAt: "2026-10-24T10:00:00.000Z"
    });
    expect(query).toHaveBeenCalledWith(expect.stringContaining("LIMIT $2 OFFSET $3"), [accountId, 10, 5]);
  });

  it("verifies the live position and cash projection against a rebuilt series of fills", async () => {
    const fillRows = [
      {
        id: "10000000-0000-4000-8000-000000000001",
        symbol: "ALFA",
        side: "buy",
        quantity: "10",
        price: "100",
        executed_at: new Date("2026-10-25T10:00:00.000Z"),
        execution_sequence: "1"
      },
      {
        id: "10000000-0000-4000-8000-000000000002",
        symbol: "ALFA",
        side: "buy",
        quantity: "5",
        price: "160",
        executed_at: new Date("2026-10-25T10:01:00.000Z"),
        execution_sequence: "2"
      },
      {
        id: "10000000-0000-4000-8000-000000000003",
        symbol: "ALFA",
        side: "sell",
        quantity: "8",
        price: "200",
        executed_at: new Date("2026-10-25T10:02:00.000Z"),
        execution_sequence: "3"
      }
    ];
    const query = vi.fn((sql: string) => {
      if (sql.includes("FROM accounts")) {
        return Promise.resolve({
          rows: [{
            id: accountId,
            cash_balance: "9797",
            reserved_balance: "0",
            opening_balance: "0"
          }]
        });
      }
      if (sql.includes("FROM ledger_entries")) {
        return Promise.resolve({
          rows: [
            { fill_id: null, entry_type: "deposit", amount: "10000" },
            { fill_id: fillRows[0]!.id, entry_type: "trade_debit", amount: "-1000" },
            { fill_id: fillRows[0]!.id, entry_type: "fee", amount: "-1" },
            { fill_id: fillRows[1]!.id, entry_type: "trade_debit", amount: "-800" },
            { fill_id: fillRows[1]!.id, entry_type: "fee", amount: "-1" },
            { fill_id: fillRows[2]!.id, entry_type: "trade_credit", amount: "1600" },
            { fill_id: fillRows[2]!.id, entry_type: "fee", amount: "-1" },
            { fill_id: null, entry_type: "reserve", amount: "-500" },
            { fill_id: null, entry_type: "release", amount: "500" }
          ]
        });
      }
      if (sql.includes("FROM fills")) {
        return Promise.resolve({ rows: fillRows });
      }
      return Promise.resolve({
        rows: [{ symbol: "ALFA", quantity: "7", avg_cost: "120" }]
      });
    });

    const response = await request(portfolioApp(query))
      .get("/api/v1/portfolio/verify")
      .set(authorization());

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ match: true, differences: [] });
  });
});
