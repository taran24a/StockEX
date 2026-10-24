export type AppErrorStatus = 400 | 401 | 403 | 404 | 409 | 413 | 415 | 422 | 429 | 500 | 502 | 503;

export class AppError extends Error {
  constructor(
    public readonly status: AppErrorStatus,
    public readonly code: string,
    message: string,
    public readonly details?: unknown
  ) {
    super(message);
    this.name = new.target.name;
  }
}

export class BadRequestError extends AppError {
  constructor(message: string, code = "BAD_REQUEST", details?: unknown) {
    super(400, code, message, details);
  }
}

export class UnauthorizedError extends AppError {
  constructor(message = "Authentication is required", code = "UNAUTHORIZED") {
    super(401, code, message);
  }
}

export class ForbiddenError extends AppError {
  constructor(message = "You do not have permission to perform this action", code = "FORBIDDEN") {
    super(403, code, message);
  }
}

export class NotFoundError extends AppError {
  constructor(message = "The requested resource was not found", code = "NOT_FOUND") {
    super(404, code, message);
  }
}

export class ConflictError extends AppError {
  constructor(message: string, code = "CONFLICT") {
    super(409, code, message);
  }
}

export class UnprocessableEntityError extends AppError {
  constructor(message: string, code = "UNPROCESSABLE_ENTITY") {
    super(422, code, message);
  }
}

export class TooManyRequestsError extends AppError {
  constructor(message = "Too many requests", code = "TOO_MANY_REQUESTS") {
    super(429, code, message);
  }
}

export class ApiError extends AppError {
  constructor(status: AppErrorStatus, code: string, message: string) {
    super(status, code, message);
  }
}
