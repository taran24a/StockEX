import type { RequestHandler, Response } from "express";
import type { ZodType } from "zod";
import { BadRequestError } from "./services/errors.js";

type RequestPart = "body" | "params" | "query";

function validateRequestPart<T>(schema: ZodType<T>, part: RequestPart): RequestHandler {
  return (request, response, next) => {
    const value = part === "body" ? request.body : part === "params" ? request.params : request.query;
    const result = schema.safeParse(value);
    if (!result.success) {
      next(
        new BadRequestError(
          result.error.issues.map((issue) => issue.message).join("; "),
          "VALIDATION_ERROR",
          result.error.issues
        )
      );
      return;
    }
    response.locals[`validated${part[0]?.toUpperCase()}${part.slice(1)}`] = result.data;
    next();
  };
}

export function validateBody<T>(schema: ZodType<T>): RequestHandler {
  return validateRequestPart(schema, "body");
}

export function validateParams<T>(schema: ZodType<T>): RequestHandler {
  return validateRequestPart(schema, "params");
}

export function validateQuery<T>(schema: ZodType<T>): RequestHandler {
  return validateRequestPart(schema, "query");
}

export function validatedBody<T>(response: Response): T {
  return response.locals.validatedBody as T;
}

export function validatedParams<T>(response: Response): T {
  return response.locals.validatedParams as T;
}

export function validatedQuery<T>(response: Response): T {
  return response.locals.validatedQuery as T;
}
