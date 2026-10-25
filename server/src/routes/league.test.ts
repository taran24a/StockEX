import express from "express";
import jwt from "jsonwebtoken";
import type { Pool } from "pg";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";
import { errorHandler } from "../middleware/error-handler.js";
import { calculateLeaguePerformance } from "../services/league-snapshot.js";
import { createLeagueRouter } from "./league.js";

const secret = "test-secret-long-enough-for-the-league-routes";
const userId = "4b8fbe96-52f4-45b9-a373-195af22bcf22";
const token = jwt.sign({ role: "user" }, secret, { subject: userId, expiresIn: "1h" });

function leagueApp(query: ReturnType<typeof vi.fn>) {
  const app = express();
  app.use("/api/league", createLeagueRouter({ query } as unknown as Pool, secret));
  app.use(errorHandler);
  return app;
}

describe("league leaderboard", () => {
  it("calculates return, maximum drawdown, and drawdown-adjusted score", () => {
    expect(calculateLeaguePerformance(100_000n, 120_000n, [110_000n, 90_000n, 120_000n])).toEqual({
      returnPct: 20,
      maxDrawdownPct: 18.1818,
      riskAdjustedScore: 1.1
    });
  });

  it("requires auth and returns a paginated ranking with ranked order", async () => {
    const query = vi.fn((sql: string) => sql.includes("COUNT(*)")
      ? Promise.resolve({ rows: [{ total: "41" }] })
      : Promise.resolve({
        rows: [{
          rank: "21",
          display_name: "Trader 21",
          current_equity_paise: "120000000",
          return_pct: "20.25",
          max_drawdown_pct: "5.50",
          risk_adjusted_score: "3.6818",
          updated_at: new Date("2026-10-25T05:00:00.000Z")
        }]
      }));
    const app = leagueApp(query);
    expect((await request(app).get("/api/league")).status).toBe(401);

    const response = await request(app)
      .get("/api/league?limit=20&offset=20")
      .set("Authorization", `Bearer ${token}`);
    expect(response.status).toBe(200);
    expect(response.body.pagination).toEqual({ limit: 20, offset: 20, total: 41 });
    expect(response.body.entries[0]).toMatchObject({
      rank: 21,
      displayName: "Trader 21",
      returnPct: 20.25,
      maxDrawdownPct: 5.5,
      riskAdjustedScore: 3.6818
    });
    expect(query).toHaveBeenCalledWith(expect.stringContaining("ROW_NUMBER() OVER"), [20, 20]);
  });

  it("validates pagination inputs", async () => {
    const query = vi.fn();
    const response = await request(leagueApp(query))
      .get("/api/league?limit=101")
      .set("Authorization", `Bearer ${token}`);
    expect(response.status).toBe(400);
    expect(query).not.toHaveBeenCalled();
  });
});
