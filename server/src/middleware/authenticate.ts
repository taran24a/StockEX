import type { RequestHandler } from "express";
import type { Request } from "express";
import jwt from "jsonwebtoken";
import { z } from "zod";
import { ForbiddenError, UnauthorizedError } from "../services/errors.js";

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
      next(new UnauthorizedError("A valid bearer token is required"));
      return;
    }

    try {
      const payload = jwt.verify(token, secret);
      if (typeof payload === "string") {
        throw new UnauthorizedError("The bearer token is invalid");
      }
      const claims = ClaimsSchema.safeParse(payload);
      if (!claims.success) {
        throw new UnauthorizedError("The bearer token is invalid");
      }
      request.auth = { id: claims.data.sub, role: claims.data.role };
      next();
    } catch (error) {
      next(error instanceof UnauthorizedError ? error : new UnauthorizedError("The bearer token is invalid or expired"));
    }
  };
}

// SYLLABUS: role-based access
export function requireRole(...roles: AuthenticatedUser["role"][]): RequestHandler {
  return (request, _response, next) => {
    if (request.auth === undefined || !roles.includes(request.auth.role)) {
      next(new ForbiddenError("Your account role cannot access this resource"));
      return;
    }
    next();
  };
}

export const authorizeRoles = requireRole;

export function requireOwnership(ownerId: (request: Request) => string | undefined): RequestHandler {
  return (request, _response, next) => {
    if (request.auth === undefined) {
      next(new UnauthorizedError());
      return;
    }
    if (ownerId(request) !== request.auth.id) {
      next(new ForbiddenError("You do not own this resource"));
      return;
    }
    next();
  };
}
