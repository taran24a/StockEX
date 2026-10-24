import express from "express";
import jwt from "jsonwebtoken";
import type { Pool } from "pg";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";
import { errorHandler } from "../middleware/error-handler.js";
import { createV1OrdersRouter } from "./v1-orders.js";

const secret = "test-secret-long-enough-for-order-history";
const userId = "4b8fbe96-52f4-45b9-a373-195af22bcf22";
const accountId = "ac8fbe96-52f4-45b9-a373-195af22bcf22";
const orderId = "bc8fbe96-52f4-45b9-a373-195af22bcf22";
const fillId = "dc8fbe96-52f4-45b9-a373-195af22bcf22";

function historyApp(query: ReturnType<typeof vi.fn>) {
  const app = express();
  app.use("/api/v1/orders", createV1OrdersRouter({ query } as unknown as Pool, secret));
  app.use(errorHandler);
  return app;
}

function authorization() {
  const token = jwt.sign({ role: "user" }, secret, { subject: userId, expiresIn: "1h" });
  return { Authorization: `Bearer ${token}` };
}

describe("v1 order timeline and replay routes", () => {
  it("returns the ordered, human-readable event timeline for an owned order", async () => {
    const query = vi.fn()
      .mockResolvedValueOnce({ rows: [{ id: orderId }] })
      .mockResolvedValueOnce({
        rows: [
          {
            id: fillId,
            aggregate_id: orderId,
            event_type: "ORDER_VALIDATED",
            sequence_number: "1",
            payload: { symbol: "ALFA", quantity: 2 },
            created_at: new Date("2026-10-25T10:00:00.000Z")
          },
          {
            id: "ec8fbe96-52f4-45b9-a373-195af22bcf22",
            aggregate_id: orderId,
            event_type: "RISK_CHECK_PASSED",
            sequence_number: "2",
            payload: { symbol: "ALFA" },
            created_at: new Date("2026-10-25T10:00:01.000Z")
          }
        ]
      });

    const response = await request(historyApp(query))
      .get(`/api/v1/orders/${orderId}/timeline`)
      .set(authorization());

    expect(response.status).toBe(200);
    expect(response.body.orderId).toBe(orderId);
    expect(response.body.events.map((event: { eventType: string; message: string }) => [
      event.eventType,
      event.message
    ])).toEqual([
      ["ORDER_VALIDATED", "Order validation passed for ALFA (2 shares)"],
      ["RISK_CHECK_PASSED", "Pre-trade risk checks passed for ALFA"]
    ]);
  });

  it("replays each order event with the account cash and holdings projection", async () => {
    const timestamps = [
      "2026-10-25T10:00:00.000Z",
      "2026-10-25T10:00:01.000Z",
      "2026-10-25T10:00:02.000Z",
      "2026-10-25T10:00:03.000Z",
      "2026-10-25T10:00:04.000Z"
    ];
    const eventTypes = [
      "ORDER_VALIDATED",
      "RISK_CHECK_PASSED",
      "ORDER_ACCEPTED",
      "ORDER_MATCHED",
      "ORDER_FILLED"
    ];
    const events = eventTypes.map((eventType, index) => ({
      id: `00000000-0000-4000-8000-00000000000${index + 1}`,
      aggregate_id: orderId,
      event_type: eventType,
      sequence_number: String(index + 1),
      payload: eventType === "ORDER_FILLED"
        ? { fillId, quantity: 10, pricePaise: 100 }
        : { symbol: "ALFA", quantity: 10 },
      created_at: new Date(timestamps[index]!)
    }));
    const query = vi.fn((sql: string) => {
      if (sql.includes("SELECT orders.id, orders.account_id")) {
        return Promise.resolve({ rows: [{ id: orderId, account_id: accountId, opening_balance: "10000" }] });
      }
      if (sql.includes("FROM domain_events") && sql.includes("aggregate_id = $1")) {
        return Promise.resolve({ rows: events });
      }
      if (sql.includes("JOIN orders AS owned_order")) {
        return Promise.resolve({ rows: events });
      }
      if (sql.includes("FROM ledger_entries")) {
        return Promise.resolve({
          rows: [
            { fill_id: fillId, entry_type: "trade_debit", amount: "-1000" },
            { fill_id: fillId, entry_type: "fee", amount: "-1" }
          ]
        });
      }
      return Promise.resolve({
        rows: [{
          id: fillId,
          symbol: "ALFA",
          side: "buy",
          quantity: "10",
          price: "100",
          executed_at: new Date(timestamps[4]!),
          execution_sequence: "1"
        }]
      });
    });

    const response = await request(historyApp(query))
      .get(`/api/v1/orders/${orderId}/replay`)
      .set(authorization());

    expect(response.status).toBe(200);
    expect(response.body.frames).toHaveLength(5);
    expect(response.body.frames[0]).toMatchObject({
      eventType: "ORDER_VALIDATED",
      cashBalancePaise: 10_000,
      holdings: []
    });
    expect(response.body.frames[4]).toMatchObject({
      eventType: "ORDER_FILLED",
      cashBalancePaise: 8_999,
      holdings: [{ symbol: "ALFA", quantity: 10, averageCostPaise: 100 }]
    });
  });
});
