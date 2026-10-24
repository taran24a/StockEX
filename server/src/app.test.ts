import request from "supertest";
import { describe, expect, it } from "vitest";
import { ErrorResponseSchema, HealthResponseSchema } from "@tradewise/shared";
import { app } from "./app.js";

describe("GET /health", () => {
  it("returns a response matching the shared health contract", async () => {
    // SYLLABUS: Postman-alternative testing
    const response = await request(app).get("/api/health");

    expect(response.status).toBe(200);
    expect(HealthResponseSchema.parse(response.body)).toEqual({ status: "ok" });
  });

  it("returns a shared error response for unknown routes", async () => {
    const response = await request(app).get("/api/not-a-route");

    expect(response.status).toBe(404);
    expect(ErrorResponseSchema.parse(response.body).error.code).toBe("NOT_FOUND");
  });

  it("rejects malformed JSON with a client error", async () => {
    const response = await request(app)
      .post("/api/not-a-route")
      .set("Content-Type", "application/json")
      .send("{");

    expect(response.status).toBe(400);
    expect(ErrorResponseSchema.parse(response.body).error.code).toBe("INVALID_JSON");
  });
});
