import { randomUUID } from "node:crypto";
import type { RequestHandler } from "express";
import { logger } from "../logger.js";

export const requestIdMiddleware: RequestHandler = (_request, response, next) => {
  const requestId = randomUUID();
  const requestLogger = logger.child({ requestId });
  response.locals.requestId = requestId;
  response.locals.logger = requestLogger;
  response.setHeader("X-Request-Id", requestId);

  const startedAt = process.hrtime.bigint();
  response.once("finish", () => {
    requestLogger.info({
      method: _request.method,
      path: _request.path,
      statusCode: response.statusCode,
      durationMs: Number(process.hrtime.bigint() - startedAt) / 1_000_000
    }, "HTTP request completed");
  });

  next();
};
