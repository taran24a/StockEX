import { randomUUID } from "node:crypto";
import * as Minio from "minio";
import { Pool } from "pg";
import request from "supertest";
import { afterAll, describe, expect, it, vi } from "vitest";
import { createApp } from "./app.js";
import { loadEnvironment } from "./config/index.js";
import { startMarketMaker } from "./services/market-maker.js";

const shouldRunSmoke = process.env.SMOKE_DATABASE_URL !== undefined;
const smokeDatabaseUrl = process.env.SMOKE_DATABASE_URL ??
  "postgresql://postgres:postgres@localhost:5432/tradewise_test";
const smokeSuite = shouldRunSmoke ? describe : describe.skip;

if (shouldRunSmoke) {
  const smokeDatabase = new URL(smokeDatabaseUrl);
  if (decodeURIComponent(smokeDatabase.pathname.slice(1)) !== "tradewise_test" ||
      !["localhost", "127.0.0.1", "postgres"].includes(smokeDatabase.hostname)) {
    throw new Error("The smoke test only permits the dedicated tradewise_test database");
  }
}

smokeSuite("API trade-flow smoke test", () => {
  const jwtSecret = "smoke-test-jwt-secret-with-sufficient-length";
  const environment = loadEnvironment({
    NODE_ENV: "test",
    DATABASE_URL: smokeDatabaseUrl,
    JWT_SECRET: jwtSecret,
    CLIENT_ORIGIN: "http://localhost:5173",
    MOCK_FEED_URL: "http://localhost:4000"
  });
  const pool = new Pool({ connectionString: smokeDatabaseUrl });
  const objectStorage = new Minio.Client({
    endPoint: environment.MINIO_ENDPOINT,
    port: environment.MINIO_PORT,
    useSSL: environment.MINIO_USE_SSL,
    accessKey: environment.MINIO_ACCESS_KEY,
    secretKey: environment.MINIO_SECRET_KEY
  });
  const app = createApp({ pool, environment, objectStorage });
  let stopMarketMaker: (() => void) | undefined;
  let originalInstrumentPrice: string | undefined;

  afterAll(async () => {
    stopMarketMaker?.();
    if (originalInstrumentPrice !== undefined) {
      await pool.query("UPDATE instruments SET last_price = $1 WHERE symbol = 'ALFA'", [originalInstrumentPrice]);
    }
    await pool.end();
  });

  it("registers, logs in, partially fills, cancels, rejects on risk, and verifies replay", async () => {
    const database = await pool.query<{ database_name: string }>(
      "SELECT current_database() AS database_name"
    );
    expect(database.rows[0]?.database_name).toBe("tradewise_test");
    const schema = await pool.query<{ accounts: string | null; instruments: string | null }>(
      `SELECT to_regclass('public.accounts') AS accounts,
              to_regclass('public.instruments') AS instruments`
    );
    expect(schema.rows[0]?.accounts).not.toBeNull();
    expect(schema.rows[0]?.instruments).not.toBeNull();

    const originalInstrument = await pool.query<{ last_price: string }>(
      "SELECT last_price FROM instruments WHERE symbol = 'ALFA'"
    );
    originalInstrumentPrice = originalInstrument.rows[0]?.last_price;
    expect(originalInstrumentPrice).toBeDefined();
    await pool.query("UPDATE instruments SET last_price = 100000 WHERE symbol = 'ALFA'");
    stopMarketMaker = startMarketMaker(pool, 250);
    await vi.waitFor(async () => {
      const makerOrder = await pool.query<{ count: string }>(
        `SELECT COUNT(*)::text AS count
         FROM orders
         JOIN users ON users.id = orders.user_id
         WHERE users.email = 'liquidity-bot@tradewise.internal'
           AND orders.symbol = 'ALFA' AND orders.side = 'sell'
           AND orders.status IN ('open', 'partially_filled')`
      );
      expect(Number(makerOrder.rows[0]?.count ?? 0)).toBeGreaterThan(0);
    }, { timeout: 15_000, interval: 100 });

    const email = `smoke-${randomUUID()}@tradewise.test`;
    const password = "Smoke-test-password-123!";
    let userId: string | undefined;
    try {
      const registration = await request(app)
        .post("/api/v1/auth/register")
        .send({ email, displayName: "Smoke Trader", password });
      expect(registration.status).toBe(201);
      userId = registration.body.user.id as string;

      const login = await request(app)
        .post("/api/v1/auth/login")
        .send({ email, password });
      expect(login.status).toBe(200);
      const token = login.body.token as string;

      const riskRules = await request(app)
        .put("/api/v1/risk/rules")
        .set("Authorization", `Bearer ${token}`)
        .send({
          maxOrderNotionalPaise: 20_000_000,
          maxSingleStockConcentrationPct: 100,
          maxSectorConcentrationPct: 100
        });
      expect(riskRules.status).toBe(200);

      const order = await request(app)
        .post("/api/v1/orders")
        .set("Authorization", `Bearer ${token}`)
        .set("Idempotency-Key", randomUUID())
        .send({
          symbol: "ALFA",
          side: "buy",
          type: "limit",
          quantity: 150,
          limitPricePaise: 120_000
        });
      expect(order.status).toBe(201);
      expect(order.body).toMatchObject({ status: "partially_filled", filledQuantity: 100 });

      const cancellation = await request(app)
        .post(`/api/v1/orders/${order.body.id}/cancel`)
        .set("Authorization", `Bearer ${token}`);
      expect(cancellation.status).toBe(200);
      expect(cancellation.body.status).toBe("cancelled");

      const rejected = await request(app)
        .post("/api/v1/orders")
        .set("Authorization", `Bearer ${token}`)
        .set("Idempotency-Key", randomUUID())
        .send({
          symbol: "ALFA",
          side: "buy",
          type: "limit",
          quantity: 200,
          limitPricePaise: 120_000
        });
      expect(rejected.status).toBe(422);
      expect(rejected.body.error.code).toBe("RISK_REJECTED");
      expect(rejected.body.error.message).toMatch(/order notional.*maximum/i);

      const verification = await request(app)
        .get("/api/v1/portfolio/verify")
        .set("Authorization", `Bearer ${token}`);
      expect(verification.status).toBe(200);
      expect(verification.body).toEqual({ match: true, differences: [] });
    } finally {
      if (userId !== undefined) {
        await pool.query("DELETE FROM users WHERE id = $1", [userId]);
      }
    }
  }, 45_000);
});
