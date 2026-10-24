import type { RequestHandler } from "express";
import jwt from "jsonwebtoken";
import { z } from "zod";
import { ApiError } from "../services/errors.js";

const ClaimsSchema = z.object({
  sub: z.uuid(),
  role: z.enum(["user", "admin"])
});

export interface AuthenticatedUser {
  id: string;
  role: "user" | "admin";
}

declare global {
  namespace Express {
    interface Request {
      auth?: AuthenticatedUser;
    }
  }
}

export function authenticate(secret: string): RequestHandler {
  return (request, _response, next) => {
    const authorization = request.header("authorization")?.split(" ");
    const [scheme, token, ...extra] = authorization ?? [];
    if (scheme !== "Bearer" || token === undefined || token.length === 0 || extra.length > 0) {
      next(new ApiError(401, "UNAUTHORIZED", "A valid bearer token is required"));
      return;
    }

    try {
      const payload = jwt.verify(token, secret);
      if (typeof payload === "string") {
        throw new ApiError(401, "UNAUTHORIZED", "The bearer token is invalid");
      }
      const claims = ClaimsSchema.safeParse(payload);
      if (!claims.success) {
        throw new ApiError(401, "UNAUTHORIZED", "The bearer token is invalid");
      }
      request.auth = { id: claims.data.sub, role: claims.data.role };
      next();
    } catch (error) {
      next(error instanceof ApiError ? error : new ApiError(401, "UNAUTHORIZED", "The bearer token is invalid or expired"));
    }
  };
}

// SYLLABUS: role-based access
export function authorizeRoles(...roles: AuthenticatedUser["role"][]): RequestHandler {
  return (request, _response, next) => {
    if (request.auth === undefined || !roles.includes(request.auth.role)) {
      next(new ApiError(403, "FORBIDDEN", "Your account role cannot access this resource"));
      return;
    }
    next();
  };
}
