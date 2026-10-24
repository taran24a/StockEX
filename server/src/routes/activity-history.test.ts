import express from "express";
import jwt from "jsonwebtoken";
import type { Pool } from "pg";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";
import { errorHandler } from "../middleware/error-handler.js";
import { createOrdersRouter } from "./orders.js";
import { createPortfolioRouter } from "./portfolio.js";

const secret = "test-secret-long-enough-for-the-history-suite";
const userId = "4b8fbe96-52f4-45b9-a373-195af22bcf22";

function historyApp(pool: Pool) {
  const app = express();
  app.use("/api", createOrdersRouter(pool, secret, "http://feed.test"));
  app.use("/api", createPortfolioRouter(pool, secret, "http://feed.test"));
  app.use(errorHandler);
  return app;
}

function userToken(): string {
  return jwt.sign({ role: "user" }, secret, { subject: userId, expiresIn: "1h" });
}

describe("paginated order and trade history", () => {
  it.each([
    ["/api/orders", "orders"],
    ["/api/trades", "trades"]
  ])("uses the requested offset for %s", async (path, _table) => {
    const query = vi.fn<(...args: unknown[]) => Promise<{ rows: unknown[] }>>()
      .mockResolvedValue({ rows: [] });
    const pool = { query } as unknown as Pool;

    const response = await request(historyApp(pool))
      .get(`${path}?limit=21&offset=40`)
      .set("Authorization", `Bearer ${userToken()}`);

    expect(response.status).toBe(200);
    expect(query).toHaveBeenCalledWith(expect.stringContaining("LIMIT $2 OFFSET $3"), [userId, 21, 40]);
  });

  it("rejects a negative offset before querying the database", async () => {
    const query = vi.fn<(...args: unknown[]) => Promise<{ rows: unknown[] }>>()
      .mockResolvedValue({ rows: [] });
    const pool = { query } as unknown as Pool;

    const response = await request(historyApp(pool))
      .get("/api/orders?offset=-1")
      .set("Authorization", `Bearer ${userToken()}`);

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe("VALIDATION_ERROR");
    expect(query).not.toHaveBeenCalled();
  });
});
