import bcrypt from "bcrypt";
import express from "express";
import * as Minio from "minio";
import type { Pool } from "pg";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";
import { loadEnvironment } from "../config/index.js";
import { errorHandler } from "../middleware/error-handler.js";
import { createAuthRouter } from "./auth.js";

const environment = loadEnvironment({
  DATABASE_URL: "postgres://tradewise:tradewise@localhost:5432/tradewise",
  JWT_SECRET: "test-secret-that-is-long-enough-for-this-suite"
});
const userId = "4b8fbe96-52f4-45b9-a373-195af22bcf22";

interface TestUser {
  id: string;
  email: string;
  display_name: string;
  role: "user" | "admin";
  password_hash?: string;
}

function createApp(pool: Pool) {
  const objectStorage = new Minio.Client({
    endPoint: environment.MINIO_ENDPOINT,
    port: environment.MINIO_PORT,
    useSSL: environment.MINIO_USE_SSL,
    accessKey: environment.MINIO_ACCESS_KEY,
    secretKey: environment.MINIO_SECRET_KEY
  });
  const app = express();
  app.use(express.json());
  app.use("/api/v1/auth", createAuthRouter(pool, environment, objectStorage));
  app.use(errorHandler);
  return app;
}

function createPool(queryHandler: (query: string, values?: unknown[]) => Promise<{ rows: unknown[] }>): Pool {
  const client = {
    query: vi.fn(queryHandler),
    release: vi.fn()
  };
  return {
    connect: vi.fn(async () => client),
    query: vi.fn(queryHandler),
    end: vi.fn()
  } as unknown as Pool;
}

describe("auth routes", () => {
  it("registers a user and funds their wallet within one transaction", async () => {
    const queries: Array<{ query: string; values?: unknown[] }> = [];
    const user: TestUser = {
      id: userId,
      email: "new@tradewise.dev",
      display_name: "New Trader",
      role: "user"
    };
    const pool = createPool(async (query, values) => {
      queries.push({ query, values });
      if (query.includes("INSERT INTO users")) {
        return { rows: [user] };
      }
      return { rows: [] };
    });
    const app = createApp(pool);

    const response = await request(app)
      .post("/api/v1/auth/register")
      .send({ email: user.email, displayName: "New Trader", password: "Trader@123456" });

    expect(response.status).toBe(201);
    expect(response.body.user).toEqual({
      id: user.id,
      email: user.email,
      displayName: user.display_name,
      role: "user"
    });
    expect(response.body.expiresAt).toEqual(expect.any(String));
    expect(response.body.token).toEqual(expect.any(String));
    expect(queries[0]?.query).toBe("BEGIN");
    expect(queries[1]?.query).toContain("INSERT INTO users");
    expect(queries[2]?.values).toEqual([user.id, 100_000_000]);
    expect(queries.at(-1)?.query).toBe("COMMIT");

    const logout = await request(app)
      .post("/api/v1/auth/logout")
      .set("Authorization", `Bearer ${response.body.token}`);
    expect(logout.status).toBe(204);
  });

  it("returns a conflict for a duplicate email and rolls back the transaction", async () => {
    const queries: string[] = [];
    const pool = createPool(async (query) => {
      queries.push(query);
      if (query.includes("INSERT INTO users")) {
        throw Object.assign(new Error("duplicate key"), { code: "23505" });
      }
      return { rows: [] };
    });

    const response = await request(createApp(pool))
      .post("/api/v1/auth/register")
      .send({ email: "duplicate@tradewise.dev", displayName: "Duplicate", password: "Trader@123456" });

    expect(response.status).toBe(409);
    expect(response.body.error.code).toBe("EMAIL_ALREADY_REGISTERED");
    expect(queries).toContain("ROLLBACK");
    expect(queries).not.toContain("COMMIT");
  });

  it("rejects an incorrect password", async () => {
    const passwordHash = await bcrypt.hash("Correct@1234", 4);
    const user: TestUser = {
      id: userId,
      email: "demo@tradewise.dev",
      display_name: "Demo",
      role: "user",
      password_hash: passwordHash
    };
    const pool = createPool(async () => ({ rows: [user] }));

    const response = await request(createApp(pool))
      .post("/api/v1/auth/login")
      .send({ email: user.email, password: "Wrong@1234" });

    expect(response.status).toBe(401);
    expect(response.body.error.code).toBe("INVALID_CREDENTIALS");
  });
});
