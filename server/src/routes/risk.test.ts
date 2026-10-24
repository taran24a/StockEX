import express from "express";
import jwt from "jsonwebtoken";
import type { Pool } from "pg";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";
import { errorHandler } from "../middleware/error-handler.js";
import { createRiskRouter } from "./risk.js";

const secret = "test-secret-long-enough-for-the-risk-suite";
const userId = "4b8fbe96-52f4-45b9-a373-195af22bcf22";
const accountId = "ac8fbe96-52f4-45b9-a373-195af22bcf22";
const alertId = "bc8fbe96-52f4-45b9-a373-195af22bcf22";

function riskApp(query: ReturnType<typeof vi.fn>) {
  const app = express();
  app.use(express.json());
  app.use("/api/v1/risk", createRiskRouter({ query } as unknown as Pool, secret));
  app.use(errorHandler);
  return app;
}

function authorization() {
  const token = jwt.sign({ role: "user" }, secret, { subject: userId, expiresIn: "1h" });
  return { Authorization: `Bearer ${token}` };
}

function rulesRow() {
  return {
    id: alertId,
    account_id: accountId,
    max_order_notional: "1000000",
    max_concentration_pct: "45",
    max_sector_concentration_pct: "45",
    created_at: new Date("2026-10-25T10:00:00.000Z"),
    updated_at: new Date("2026-10-25T10:00:00.000Z")
  };
}

describe("risk routes", () => {
  it("previews projected stock and sector concentration without placing an order", async () => {
    const query = vi.fn((sql: string) => {
      if (sql.includes("SELECT id FROM accounts")) return Promise.resolve({ rows: [{ id: accountId }] });
      if (sql.includes("INSERT INTO risk_rules")) return Promise.resolve({ rows: [rulesRow()] });
      if (sql.includes("SELECT symbol, sector, last_price")) {
        return Promise.resolve({ rows: [{ symbol: "ALFA", sector: "Technology", last_price: "1000" }] });
      }
      if (sql.includes("SELECT cash_balance FROM accounts")) return Promise.resolve({ rows: [{ cash_balance: "80000" }] });
      if (sql.includes("FROM positions AS position")) {
        return Promise.resolve({ rows: [{ symbol: "ALFA", sector: "Technology", market_value: "20000" }] });
      }
      throw new Error(`Unexpected query: ${sql}`);
    });

    const response = await request(riskApp(query))
      .post("/api/v1/risk/preview")
      .set(authorization())
      .send({ symbol: "ALFA", side: "buy", quantity: 50 });

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      symbol: "ALFA",
      sector: "Technology",
      side: "buy",
      quantity: 50,
      pricePaise: 1000,
      orderNotionalPaise: 50000,
      totalEquityPaise: 100000,
      currentStockPct: 20,
      projectedStockPct: 70,
      currentSectorPct: 20,
      projectedSectorPct: 70,
      rejection: "This trade would raise ALFA from 20% to 70%, exceeding your 45% limit"
    });
    expect(query.mock.calls.some(([sql]) => String(sql).includes("INSERT INTO orders"))).toBe(false);
  });

  it("rejects invalid preview input before querying account data", async () => {
    const query = vi.fn();
    const response = await request(riskApp(query))
      .post("/api/v1/risk/preview")
      .set(authorization())
      .send({ symbol: "alfa", side: "buy", quantity: 0 });

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe("VALIDATION_ERROR");
    expect(query).not.toHaveBeenCalled();
  });

  it("updates read state only for an alert belonging to the signed-in account", async () => {
    const query = vi.fn()
      .mockResolvedValueOnce({ rows: [{ id: accountId }] })
      .mockResolvedValueOnce({
        rows: [{
          id: alertId,
          account_id: accountId,
          rule_id: null,
          order_id: null,
          alert_type: "CONCENTRATION_WARNING",
          severity: "warning",
          message: "Exposure is near the configured limit",
          details: {},
          acknowledged_at: new Date("2026-10-25T11:00:00.000Z"),
          created_at: new Date("2026-10-25T10:00:00.000Z")
        }]
      });

    const response = await request(riskApp(query))
      .patch(`/api/v1/risk/alerts/${alertId}`)
      .set(authorization())
      .send({ acknowledged: true });

    expect(response.status).toBe(200);
    expect(response.body.acknowledgedAt).toBe("2026-10-25T11:00:00.000Z");
    expect(query.mock.calls[1]?.[1]).toEqual([alertId, accountId, true]);
  });
});
