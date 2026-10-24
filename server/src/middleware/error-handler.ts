import type { ErrorRequestHandler } from "express";
import multer from "multer";
import { ErrorResponseSchema } from "@tradewise/shared";
import { logger } from "../logger.js";
import { ApiError, AppError } from "../services/errors.js";

// SYLLABUS: error middleware
export const errorHandler: ErrorRequestHandler = (error: unknown, request, response, _next) => {
  const requestLogger = response.locals.logger ?? logger;
  if (error instanceof multer.MulterError) {
    const isTooLarge = error.code === "LIMIT_FILE_SIZE";
    const uploadError = new ApiError(
      isTooLarge ? 413 : 400,
      isTooLarge ? "UPLOAD_TOO_LARGE" : "INVALID_UPLOAD",
      isTooLarge ? "Avatar must be no larger than 2 MB" : "The avatar upload was invalid"
    );
    response.status(uploadError.status).json(ErrorResponseSchema.parse({
      error: { code: uploadError.code, message: uploadError.message }
    }));
    return;
  }
  const apiError = error instanceof AppError
    ? error
    : error instanceof Error && "status" in error && error.status === 404
      ? new ApiError(404, "NOT_FOUND", "The requested resource was not found")
      : error instanceof SyntaxError && "status" in error && error.status === 400
        ? new ApiError(400, "INVALID_JSON", "Request body must contain valid JSON")
      : undefined;

  if (apiError === undefined) {
    requestLogger.error({ err: error, path: request.path }, "Unhandled request error");
  }

  const status = apiError?.status ?? 500;
  const body = ErrorResponseSchema.parse({
    error: {
      code: apiError?.code ?? "INTERNAL_ERROR",
      message: apiError?.message ?? "An unexpected error occurred",
      ...(apiError?.details === undefined ? {} : { details: apiError.details })
    }
  });
  response.status(status).json(body);
};
