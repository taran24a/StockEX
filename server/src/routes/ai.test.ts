import express from "express";
import jwt from "jsonwebtoken";
import type { Pool } from "pg";
import request from "supertest";
import { afterEach, describe, expect, it, vi } from "vitest";
import { loadEnvironment } from "../config/index.js";
import { errorHandler } from "../middleware/error-handler.js";
import { createAiRouter } from "./ai.js";

const secret = "test-secret-long-enough-for-the-ai-route-suite";
const userId = "4b8fbe96-52f4-45b9-a373-195af22bcf22";
const environment = loadEnvironment({
  JWT_SECRET: secret,
  OLLAMA_BASE_URL: "http://ollama.test",
  OLLAMA_MODEL: "local-model"
});

function aiApp(pool: Pool) {
  const app = express();
  app.use(express.json());
  app.use("/api/ai", createAiRouter(pool, environment));
  app.use(errorHandler);
  return app;
}

function authorization() {
  const token = jwt.sign({ role: "user" }, secret, { subject: userId, expiresIn: "1h" });
  return { Authorization: `Bearer ${token}` };
}

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

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("AI portfolio explanation routes", () => {
  it("requires authentication and returns a deterministic GET explanation", async () => {
    const app = aiApp(portfolioPool());
    expect((await request(app).get("/api/ai/explain")).status).toBe(401);

    const response = await request(app).get("/api/ai/explain").set(authorization());
    expect(response.status).toBe(200);
    expect(response.body.source).toBe("template");
    expect(response.body.metrics.totalEquityPaise).toBe(112_000_000);
    expect(response.body.explanation).toContain("12.00%");
  });

  it("sends only numeric portfolio values to Ollama and validates its JSON output", async () => {
    const fetchMock = vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
      const sent = JSON.parse(String(init?.body)) as { prompt: string; system: string };
      expect(sent.prompt).not.toContain("NOVA");
      expect(sent.prompt).toContain("112000000");
      expect(sent.system).toContain("Do not recommend trades");
      return new Response(JSON.stringify({
        response: JSON.stringify({
          summary: "Equity is above contributed capital in this snapshot.",
          observations: ["Recorded return is positive."]
        })
      }), { status: 200, headers: { "Content-Type": "application/json" } });
    });
    vi.stubGlobal("fetch", fetchMock);

    const response = await request(aiApp(portfolioPool())).post("/api/ai/explain").set(authorization());
    expect(response.status).toBe(200);
    expect(response.body.source).toBe("ollama");
    expect(response.body.explanation).toBe("Equity is above contributed capital in this snapshot.");
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("uses the deterministic explanation when Ollama cannot be reached", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("connection refused")));
    const response = await request(aiApp(portfolioPool())).post("/api/ai/explain").set(authorization());
    expect(response.status).toBe(200);
    expect(response.body.source).toBe("template");
    expect(response.body.explanation).toContain("not trading advice");
  });

  it("rejects malformed model JSON instead of treating it as a successful explanation", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({
      response: JSON.stringify({ summary: "A result", observations: [], unsupported: true })
    }), { status: 200, headers: { "Content-Type": "application/json" } })));
    const response = await request(aiApp(portfolioPool())).post("/api/ai/explain").set(authorization());
    expect(response.status).toBe(502);
    expect(response.body.error.code).toBe("INVALID_AI_RESPONSE");
  });
});
