import type { Request } from "express";
import type { ZodType } from "zod";
import { ApiError } from "./errors.js";

export function validateBody<T>(schema: ZodType<T>, body: unknown): T {
  const result = schema.safeParse(body);
  if (!result.success) {
    throw new ApiError(400, "VALIDATION_ERROR", result.error.issues.map((issue) => issue.message).join("; "));
  }
  return result.data;
}

export function validateQuery<T>(schema: ZodType<T>, request: Request): T {
  return validateBody(schema, request.query);
}
