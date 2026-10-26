import { Router } from "express";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import type { Client as MinioClient } from "minio";
import xss from "xss";
import {
  AuthResponseSchema,
  LoginRequestSchema,
  ProfileResponseSchema,
  RegisterRequestSchema,
  UserSchema
} from "@tradewise/shared";
import type { LoginRequest, RegisterRequest } from "@tradewise/shared";
import type { Pool } from "pg";
import type { Environment } from "../config/index.js";
import { ApiError } from "../services/errors.js";
import { validatedBody, validateBody } from "../http-validation.js";
import { authenticate } from "../middleware/authenticate.js";
import { withTransaction } from "../db/transaction.js";
import { createAvatarRouter } from "./avatar.js";
import { randomBytes } from "node:crypto";

interface UserRow {
  id: string;
  email: string;
  display_name: string;
  password_hash?: string;
  role: "user" | "admin";
  avatar_object_key?: string | null;
}

const accessTokenLifetimeSeconds = 12 * 60 * 60;

function createToken(user: UserRow, secret: string): { token: string; expiresAt: string } {
  // SYLLABUS: JWT
  const issuedAt = Math.floor(Date.now() / 1000);
  const expiresAt = issuedAt + accessTokenLifetimeSeconds;
  return {
    token: jwt.sign({ role: user.role, iat: issuedAt, exp: expiresAt }, secret, { subject: user.id }),
    expiresAt: new Date(expiresAt * 1000).toISOString()
  };
}

function authResponse(user: UserRow, secret: string): unknown {
  const accessToken = createToken(user, secret);
  return AuthResponseSchema.parse({
    ...accessToken,
    user: {
      id: user.id,
      email: user.email,
      displayName: user.display_name,
      role: user.role
    }
  });
}

export function createAuthRouter(pool: Pool, environment: Environment, objectStorage: MinioClient): Router {
  const router = Router();
  const requireAuth = authenticate(environment.JWT_SECRET);
  router.use(createAvatarRouter(pool, environment, objectStorage, false));

  router.post("/register", validateBody(RegisterRequestSchema), async (_request, response) => {
    // SYLLABUS: validation
    const input = validatedBody<RegisterRequest>(response);
    // SYLLABUS: sanitization
    const displayName = xss(input.displayName, {
      whiteList: {},
      stripIgnoreTag: true,
      stripIgnoreTagBody: ["script", "style"]
    }).trim();
    if (displayName.length < 2) {
      throw new ApiError(400, "VALIDATION_ERROR", "Display name must contain at least two visible characters");
    }

    // SYLLABUS: bcrypt
    const passwordHash = await bcrypt.hash(input.password, 12);
    try {
      const user = await withTransaction(pool, async (client) => {
        const inserted = await client.query<UserRow>(
          `INSERT INTO users (email, display_name, password_hash)
           VALUES ($1, $2, $3)
           RETURNING id, email, display_name, role`,
          [input.email.toLowerCase(), displayName, passwordHash]
        );
        const createdUser = inserted.rows[0];
        if (createdUser === undefined) {
          throw new Error("User insert returned no row");
        }
        await client.query(
          "INSERT INTO wallets (user_id, balance_paise) VALUES ($1, $2)",
          [createdUser.id, 100_000_000]
        );
        await client.query(
          `INSERT INTO ledger_entries (account_id, entry_type, amount, balance_after)
           SELECT account.id, 'deposit', account.cash_balance, account.cash_balance
           FROM accounts AS account
           WHERE account.user_id = $1`,
          [createdUser.id]
        );
        return createdUser;
      });
      response.status(201).json(authResponse(user, environment.JWT_SECRET));
    } catch (error) {
      if (typeof error === "object" && error !== null && "code" in error && error.code === "23505") {
        throw new ApiError(409, "EMAIL_ALREADY_REGISTERED", "An account with this email already exists");
      }
      throw error;
    }
  });

  router.post("/login", validateBody(LoginRequestSchema), async (_request, response) => {
    const input = validatedBody<LoginRequest>(response);
    const result = await pool.query<UserRow>(
      `SELECT id, email, display_name, password_hash, role
       FROM users
       WHERE email = $1`,
      [input.email.toLowerCase()]
    );
    const user = result.rows[0];
    if (user?.password_hash == null || !(await bcrypt.compare(input.password, user.password_hash))) {
      throw new ApiError(401, "INVALID_CREDENTIALS", "Email or password is incorrect");
    }
    response.json(authResponse(user, environment.JWT_SECRET));
  });

  router.post("/google", async (request, response) => {
    if (!environment.GOOGLE_CLIENT_ID) {
      throw new ApiError(503, "GOOGLE_SIGN_IN_NOT_CONFIGURED", "Google sign-in is not configured yet");
    }
    const idToken = typeof request.body?.credential === "string" ? request.body.credential : "";
    if (!idToken || idToken.length > 10_000) {
      throw new ApiError(400, "INVALID_GOOGLE_CREDENTIAL", "Google did not provide a valid sign-in credential");
    }
    const googleResponse = await fetch(`https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(idToken)}`);
    if (!googleResponse.ok) {
      throw new ApiError(401, "INVALID_GOOGLE_CREDENTIAL", "Google sign-in could not verify your account");
    }
    const claims: unknown = await googleResponse.json();
    if (typeof claims !== "object" || claims === null) {
      throw new ApiError(401, "INVALID_GOOGLE_CREDENTIAL", "Google sign-in could not verify your account");
    }
    const payload = claims as Record<string, unknown>;
    const issuerValid = payload.iss === "accounts.google.com" || payload.iss === "https://accounts.google.com";
    const expiresAt = Number(payload.exp);
    if (payload.aud !== environment.GOOGLE_CLIENT_ID || !issuerValid || !Number.isFinite(expiresAt) || expiresAt <= Date.now() / 1000 ||
        payload.email_verified !== "true" || typeof payload.email !== "string" || typeof payload.sub !== "string" ||
        typeof payload.name !== "string") {
      throw new ApiError(401, "INVALID_GOOGLE_CREDENTIAL", "Google sign-in could not verify your account");
    }

    const email = payload.email.toLowerCase();
    const googleSub = payload.sub;
    const existing = await pool.query<UserRow>(
      `SELECT id, email, display_name, role FROM users WHERE google_sub = $1 OR email = $2 LIMIT 1`,
      [googleSub, email]
    );
    let user = existing.rows[0];
    if (user !== undefined) {
      await pool.query("UPDATE users SET google_sub = $1 WHERE id = $2 AND google_sub IS NULL", [googleSub, user.id]);
    } else {
      const displayName = xss(payload.name, { whiteList: {}, stripIgnoreTag: true, stripIgnoreTagBody: ["script", "style"] }).trim().slice(0, 60) || "Google user";
      const randomPasswordHash = await bcrypt.hash(randomBytes(32).toString("hex"), 12);
      try {
        user = await withTransaction(pool, async (client) => {
          const inserted = await client.query<UserRow>(
            `INSERT INTO users (email, display_name, password_hash, google_sub)
             VALUES ($1, $2, $3, $4) RETURNING id, email, display_name, role`,
            [email, displayName, randomPasswordHash, googleSub]
          );
          const createdUser = inserted.rows[0];
          if (createdUser === undefined) throw new Error("Google user insert returned no row");
          await client.query("INSERT INTO wallets (user_id, balance_paise) VALUES ($1, $2)", [createdUser.id, 100_000_000]);
          await client.query(
            `INSERT INTO ledger_entries (account_id, entry_type, amount, balance_after)
             SELECT account.id, 'deposit', account.cash_balance, account.cash_balance FROM accounts AS account WHERE account.user_id = $1`,
            [createdUser.id]
          );
          return createdUser;
        });
      } catch (error) {
        if (typeof error === "object" && error !== null && "code" in error && error.code === "23505") {
          throw new ApiError(409, "GOOGLE_ACCOUNT_LINK_CONFLICT", "This Google account is already linked. Please sign in with your existing method.");
        }
        throw error;
      }
    }
    if (user === undefined) throw new ApiError(500, "AUTHENTICATION_FAILED", "Google sign-in could not create a session");
    response.status(existing.rows[0] === undefined ? 201 : 200).json(authResponse(user, environment.JWT_SECRET));
  });

  router.get("/me", requireAuth, async (request, response) => {
    const result = await pool.query<UserRow>(
      "SELECT id, email, display_name, role, avatar_object_key FROM users WHERE id = $1",
      [request.auth?.id]
    );
    const user = result.rows[0];
    if (user === undefined) {
      throw new ApiError(401, "UNAUTHORIZED", "The authenticated account no longer exists");
    }
    const avatarUrl = user.avatar_object_key === undefined || user.avatar_object_key === null
      ? null
      : await objectStorage.presignedGetObject(environment.MINIO_BUCKET, user.avatar_object_key, 15 * 60);
    response.json(ProfileResponseSchema.parse({
      user: UserSchema.parse({
        id: user.id,
        email: user.email,
        displayName: user.display_name,
        role: user.role
      }),
      avatarUrl
    }));
  });

  router.post("/logout", requireAuth, (_request, response) => {
    response.sendStatus(204);
  });

  return router;
}
