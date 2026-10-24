import express from "express";
import jwt from "jsonwebtoken";
import type { Pool } from "pg";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";
import { errorHandler } from "../middleware/error-handler.js";
import { createAdminRouter } from "./admin.js";

const secret = "test-secret-long-enough-for-the-admin-routes";
const userId = "4b8fbe96-52f4-45b9-a373-195af22bcf22";
const adminId = "ac8fbe96-52f4-45b9-a373-195af22bcf22";

function authorization(userRole: "user" | "admin", subject = userRole === "admin" ? adminId : userId) {
  const token = jwt.sign({ role: userRole }, secret, { subject, expiresIn: "1h" });
  return { Authorization: `Bearer ${token}` };
}

function adminApp(pool: Pool) {
  const app = express();
  app.use(express.json());
  app.use("/api/admin", createAdminRouter(pool, secret));
  app.use(errorHandler);
  return app;
}

describe("admin routes", () => {
  it("blocks non-admin users before reaching protected route handlers", async () => {
    const query = vi.fn();
    const connect = vi.fn();
    const app = adminApp({ query, connect } as unknown as Pool);

    const users = await request(app).get("/api/admin/users").set(authorization("user"));
    const importResponse = await request(app)
      .post("/api/admin/instruments/import")
      .set(authorization("user"));

    expect(users.status).toBe(403);
    expect(importResponse.status).toBe(403);
    expect(query).not.toHaveBeenCalled();
    expect(connect).not.toHaveBeenCalled();
  });

  it("imports validated instrument rows from a streamed CSV upload", async () => {
    const clientQuery = vi.fn(async () => ({ rows: [], rowCount: 1 }));
    const pool = {
      connect: vi.fn(async () => ({ query: clientQuery, release: vi.fn() }))
    } as unknown as Pool;
    const response = await request(adminApp(pool))
      .post("/api/admin/instruments/import")
      .set(authorization("admin"))
      .attach(
        "file",
        Buffer.from('symbol,name,sector,tick_size,last_price\r\nNOVA,"Nova, Systems",Technology,5,12500\r\n'),
        { filename: "instruments.csv", contentType: "text/csv" }
      );

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ imported: 1 });
    expect(clientQuery).toHaveBeenCalledWith(
      expect.stringContaining("INSERT INTO instruments"),
      ["NOVA", "Nova, Systems", "Technology", 5, 12500]
    );
    expect(clientQuery).toHaveBeenCalledWith("COMMIT");
  });

  it("returns paginated admin user results", async () => {
    const query = vi.fn((sql: string) => {
      if (sql.includes("COUNT(*)")) {
        return Promise.resolve({ rows: [{ total: "1" }] });
      }
      return Promise.resolve({
        rows: [{
          id: userId,
          email: "trader@tradewise.dev",
          display_name: "Trader",
          role: "user",
          created_at: new Date("2026-10-25T10:00:00.000Z")
        }]
      });
    });
    const response = await request(adminApp({ query } as unknown as Pool))
      .get("/api/admin/users?limit=1&offset=4")
      .set(authorization("admin"));

    expect(response.status).toBe(200);
    expect(response.body.pagination).toEqual({ limit: 1, offset: 4, total: 1 });
    expect(response.body.users[0]).toMatchObject({ id: userId, role: "user" });
    expect(query).toHaveBeenCalledWith(expect.stringContaining("LIMIT $1 OFFSET $2"), [1, 4]);
  });

  it("allows only administrators to configure the virtual reset cooldown", async () => {
    const query = vi.fn()
      .mockResolvedValueOnce({ rows: [{ value: 48, updated_at: new Date("2026-10-25T10:00:00.000Z") }] })
      .mockResolvedValueOnce({ rows: [{ value: 48, updated_at: new Date("2026-10-25T10:00:00.000Z") }] });
    const app = adminApp({ query } as unknown as Pool);

    const forbidden = await request(app)
      .put("/api/admin/settings/virtual-account-reset-cooldown")
      .set(authorization("user"))
      .send({ cooldownHours: 48 });
    expect(forbidden.status).toBe(403);
    expect(query).not.toHaveBeenCalled();

    const response = await request(app)
      .put("/api/admin/settings/virtual-account-reset-cooldown")
      .set(authorization("admin"))
      .send({ cooldownHours: 48 });

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ cooldownHours: 48, updatedAt: "2026-10-25T10:00:00.000Z" });
    expect(query).toHaveBeenCalledWith(
      expect.stringContaining("INSERT INTO system_settings"),
      ["virtual_account_reset_cooldown_hours", 48]
    );
  });
});
