import express from "express";
import jwt from "jsonwebtoken";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { ErrorResponseSchema } from "@tradewise/shared";
import { authenticate, authorizeRoles } from "./authenticate.js";

const secret = "test-secret-long-enough-for-the-test-suite";
const userId = "4b8fbe96-52f4-45b9-a373-195af22bcf22";

function protectedApp() {
  const app = express();
  app.get(
    "/admin",
    authenticate(secret),
    authorizeRoles("admin"),
    (request, response) => response.json({ userId: request.auth?.id })
  );
  app.use((error: unknown, _request: express.Request, response: express.Response, _next: express.NextFunction) => {
    const parsed = ErrorResponseSchema.parse({
      error: {
        code: error instanceof Error && "code" in error ? error.code : "ERROR",
        message: error instanceof Error ? error.message : "Error"
      }
    });
    response.status(error instanceof Error && "status" in error && typeof error.status === "number" ? error.status : 500).json(parsed);
  });
  return app;
}

describe("authentication and role middleware", () => {
  it("rejects requests without a bearer token", async () => {
    const response = await request(protectedApp()).get("/admin");

    expect(response.status).toBe(401);
    expect(response.body.error.code).toBe("UNAUTHORIZED");
  });

  it("rejects a valid user token from admin-only routes", async () => {
    const token = jwt.sign({ role: "user" }, secret, { subject: userId, expiresIn: "1h" });
    const response = await request(protectedApp()).get("/admin").set("Authorization", `Bearer ${token}`);

    expect(response.status).toBe(403);
    expect(response.body.error.code).toBe("FORBIDDEN");
  });

  it("allows a valid admin token", async () => {
    const token = jwt.sign({ role: "admin" }, secret, { subject: userId, expiresIn: "1h" });
    const response = await request(protectedApp()).get("/admin").set("Authorization", `Bearer ${token}`);

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ userId });
  });
});
