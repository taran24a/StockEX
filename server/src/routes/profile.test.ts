import bcrypt from "bcrypt";
import express from "express";
import jwt from "jsonwebtoken";
import type { Client as MinioClient } from "minio";
import type { Pool } from "pg";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";
import { loadEnvironment } from "../config/index.js";
import { errorHandler } from "../middleware/error-handler.js";
import { createAvatarRouter } from "./avatar.js";

const secret = "test-secret-long-enough-for-the-profile-suite";
const userId = "4b8fbe96-52f4-45b9-a373-195af22bcf22";
const accountId = "ac8fbe96-52f4-45b9-a373-195af22bcf22";
const environment = loadEnvironment({ JWT_SECRET: secret });
const storage = { presignedGetObject: vi.fn().mockResolvedValue("https://storage.test/avatar") } as unknown as MinioClient;

function profileApp(query: ReturnType<typeof vi.fn>) {
  const client = { query, release: vi.fn() };
  const pool = {
    query,
    connect: vi.fn().mockResolvedValue(client)
  } as unknown as Pool;
  const app = express();
  app.use(express.json());
  app.use("/api/v1/users", createAvatarRouter(pool, environment, storage));
  app.use(errorHandler);
  return app;
}

function authorization() {
  const token = jwt.sign({ role: "user" }, secret, { subject: userId, expiresIn: "1h" });
  return { Authorization: `Bearer ${token}` };
}

describe("profile routes", () => {
  it("returns profile account information and the reset cooldown", async () => {
    const query = vi.fn()
      .mockResolvedValueOnce({
        rows: [{
          id: userId,
          email: "trader@example.com",
          display_name: "Trader",
          role: "user",
          avatar_object_key: null,
          created_at: new Date("2026-10-01T10:00:00.000Z"),
          last_virtual_reset_at: null
        }]
      })
      .mockResolvedValueOnce({ rows: [{ value: 24 }] });

    const response = await request(profileApp(query)).get("/api/v1/users/me").set(authorization());

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      user: { id: userId, email: "trader@example.com", displayName: "Trader", role: "user" },
      avatarUrl: null,
      createdAt: "2026-10-01T10:00:00.000Z",
      resetCooldownHours: 24,
      lastResetAt: null,
      nextResetAt: null
    });
  });

  it("updates the sanitized display name", async () => {
    const query = vi.fn().mockResolvedValueOnce({
      rows: [{ id: userId, email: "trader@example.com", display_name: "New Trader", role: "user" }]
    });

    const response = await request(profileApp(query))
      .patch("/api/v1/users/me")
      .set(authorization())
      .send({ displayName: "<b>New Trader</b>" });

    expect(response.status).toBe(200);
    expect(response.body.displayName).toBe("New Trader");
  });

  it("changes the password only after verifying the existing bcrypt hash", async () => {
    const passwordHash = await bcrypt.hash("CorrectCurrent123", 4);
    const query = vi.fn((sql: string, _parameters?: unknown[]) => {
      if (sql === "SELECT password_hash FROM users WHERE id = $1 FOR UPDATE") {
        return Promise.resolve({ rows: [{ password_hash: passwordHash }] });
      }
      return Promise.resolve({ rows: [], rowCount: 1 });
    });

    const response = await request(profileApp(query))
      .patch("/api/v1/users/me/password")
      .set(authorization())
      .send({ currentPassword: "CorrectCurrent123", newPassword: "NewCorrectPassword123" });

    expect(response.status).toBe(204);
    const savedHash = query.mock.calls.find(([sql]) => String(sql).includes("UPDATE users SET password_hash"))?.[1]?.[0];
    expect(typeof savedHash).toBe("string");
    expect(await bcrypt.compare("NewCorrectPassword123", String(savedHash))).toBe(true);
    expect(String(savedHash)).not.toBe("NewCorrectPassword123");
  });

  it("rejects an incorrect current password without changing the stored hash", async () => {
    const passwordHash = await bcrypt.hash("CorrectCurrent123", 4);
    const query = vi.fn((sql: string, _parameters?: unknown[]) => sql === "SELECT password_hash FROM users WHERE id = $1 FOR UPDATE"
      ? Promise.resolve({ rows: [{ password_hash: passwordHash }] })
      : Promise.resolve({ rows: [], rowCount: 0 }));

    const response = await request(profileApp(query))
      .patch("/api/v1/users/me/password")
      .set(authorization())
      .send({ currentPassword: "WrongCurrent123", newPassword: "NewCorrectPassword123" });

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe("CURRENT_PASSWORD_INCORRECT");
    expect(query.mock.calls.some(([sql]) => String(sql).includes("UPDATE users SET password_hash"))).toBe(false);
  });

  it("resets only the authenticated account and records an auditable reset ledger entry", async () => {
    const resetAt = new Date("2026-10-25T11:00:00.000Z");
    const query = vi.fn((sql: string) => {
      if (sql === "BEGIN" || sql === "COMMIT" || sql === "ROLLBACK") return Promise.resolve({ rows: [] });
      if (sql.includes("FROM accounts WHERE user_id")) return Promise.resolve({
        rows: [{
          id: accountId,
          user_id: userId,
          cash_balance: "60000000",
          reserved_balance: "1000",
          opening_balance: "0",
          last_virtual_reset_at: null
        }]
      });
      if (sql.includes("FROM system_settings")) return Promise.resolve({ rows: [{ value: 24 }] });
      if (sql.includes("FROM orders") && sql.includes("FOR UPDATE")) return Promise.resolve({
        rows: [{ id: "order-1", reserved_amount: "1000" }],
        rowCount: 1
      });
      if (sql.includes("DELETE FROM positions")) return Promise.resolve({ rows: [], rowCount: 2 });
      if (sql.includes("RETURNING last_virtual_reset_at")) return Promise.resolve({ rows: [{ last_virtual_reset_at: resetAt }] });
      return Promise.resolve({ rows: [], rowCount: 1 });
    });

    const response = await request(profileApp(query))
      .post("/api/v1/users/me/reset")
      .set(authorization())
      .send({ confirm: "RESET" });

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      cashBalancePaise: 100_000_000,
      cancelledOrders: 1,
      clearedPositions: 2,
      nextResetAt: "2026-10-26T11:00:00.000Z"
    });
    expect(query.mock.calls.some(([sql]) => String(sql).includes("INSERT INTO ledger_entries") && String(sql).includes("'virtual_reset'"))).toBe(true);
    expect(query.mock.calls.some(([sql]) => String(sql).includes("DELETE FROM positions WHERE account_id = $1"))).toBe(true);
    expect(query.mock.calls.some(([sql]) => String(sql).includes("UPDATE orders") && String(sql).includes("'ACCOUNT_RESET'"))).toBe(true);
  });

  it("enforces the configured reset cooldown before changing the account", async () => {
    const query = vi.fn((sql: string) => {
      if (sql === "BEGIN" || sql === "COMMIT" || sql === "ROLLBACK") return Promise.resolve({ rows: [] });
      if (sql.includes("FROM accounts WHERE user_id")) return Promise.resolve({
        rows: [{
          id: accountId,
          user_id: userId,
          cash_balance: "100000000",
          reserved_balance: "0",
          opening_balance: "0",
          last_virtual_reset_at: new Date(Date.now() - 1000)
        }]
      });
      if (sql.includes("FROM system_settings")) return Promise.resolve({ rows: [{ value: 24 }] });
      return Promise.resolve({ rows: [], rowCount: 0 });
    });

    const response = await request(profileApp(query))
      .post("/api/v1/users/me/reset")
      .set(authorization())
      .send({ confirm: "RESET" });

    expect(response.status).toBe(429);
    expect(response.body.error.code).toBe("RESET_COOLDOWN_ACTIVE");
    expect(query.mock.calls.some(([sql]) => String(sql).includes("DELETE FROM positions"))).toBe(false);
    expect(query.mock.calls.some(([sql]) => String(sql).includes("UPDATE accounts"))).toBe(false);
  });
});
