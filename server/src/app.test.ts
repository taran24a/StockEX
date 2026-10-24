import express from "express";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { ErrorResponseSchema, HealthResponseSchema } from "@tradewise/shared";
import { app } from "./app.js";
import { NotFoundError } from "./services/errors.js";
import { errorHandler } from "./middleware/error-handler.js";
import { sanitizeRequest } from "./middleware/sanitize-request.js";
import { validateBody, validateParams, validateQuery } from "./http-validation.js";

const validationApp = express();
validationApp.use(express.json());
validationApp.use(sanitizeRequest);
validationApp.post(
  "/body",
  validateBody(z.object({ name: z.string().min(2) })),
  (request, response) => response.json(request.body)
);
validationApp.get(
  "/params/:id",
  validateParams(z.object({ id: z.uuid() })),
  (_request, response) => response.sendStatus(204)
);
validationApp.get(
  "/query",
  validateQuery(z.object({ limit: z.coerce.number().int().min(1).max(10) })),
  (_request, response) => response.sendStatus(204)
);
validationApp.use((_request, _response, next) => next(new NotFoundError()));
validationApp.use(errorHandler);

describe("GET /api/v1/health", () => {
  it("returns a response matching the shared health contract", async () => {
    // SYLLABUS: Postman-alternative testing
    const response = await request(app).get("/api/v1/health");

    expect(response.status).toBe(200);
    expect(HealthResponseSchema.parse(response.body)).toEqual({ status: "ok" });
    expect(response.headers["x-request-id"]).toMatch(/^[0-9a-f-]{36}$/);
    expect(response.headers["x-content-type-options"]).toBe("nosniff");
  });

  it("returns a shared error response for unknown routes", async () => {
    const response = await request(app).get("/api/not-a-route");

    expect(response.status).toBe(404);
    expect(ErrorResponseSchema.parse(response.body).error.code).toBe("NOT_FOUND");
  });

  it("returns a shared validation error for an invalid request body", async () => {
    const response = await request(validationApp).post("/body").send({ name: "x" });

    expect(response.status).toBe(400);
    expect(ErrorResponseSchema.parse(response.body).error.code).toBe("VALIDATION_ERROR");
  });

  it("sanitizes request strings without changing password values", async () => {
    const response = await request(validationApp)
      .post("/body")
      .send({ name: "<b>Trader</b>", password: "<b>unchanged</b>" });

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ name: "Trader", password: "<b>unchanged</b>" });
  });

  it("validates route parameters and query parameters", async () => {
    const invalidParams = await request(validationApp).get("/params/not-a-uuid");
    const invalidQuery = await request(validationApp).get("/query?limit=11");

    expect(invalidParams.status).toBe(400);
    expect(ErrorResponseSchema.parse(invalidParams.body).error.code).toBe("VALIDATION_ERROR");
    expect(invalidQuery.status).toBe(400);
    expect(ErrorResponseSchema.parse(invalidQuery.body).error.code).toBe("VALIDATION_ERROR");
  });

  it("rejects malformed JSON with a client error", async () => {
    const response = await request(app).post("/api/not-a-route").set("Content-Type", "application/json").send("{");

    expect(response.status).toBe(400);
    expect(ErrorResponseSchema.parse(response.body).error.code).toBe("INVALID_JSON");
  });
});
