import { Router } from "express";
import { randomUUID } from "node:crypto";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import multer from "multer";
import type { Client as MinioClient } from "minio";
import xss from "xss";
import {
  AvatarFileMetadataSchema,
  AvatarResponseSchema,
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
import { logger } from "../logger.js";

interface UserRow {
  id: string;
  email: string;
  display_name: string;
  password_hash?: string;
  role: "user" | "admin";
  avatar_object_key?: string | null;
}

const allowedImageTypes = new Map([
  ["image/jpeg", "jpg"],
  ["image/png", "png"],
  ["image/webp", "webp"]
]);

// SYLLABUS: Multer
const avatarUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 2 * 1024 * 1024, files: 1 },
  fileFilter: (_request, file, callback) => {
    if (!allowedImageTypes.has(file.mimetype)) {
      callback(new ApiError(415, "UNSUPPORTED_IMAGE_TYPE", "Avatar must be a JPEG, PNG, or WebP image"));
      return;
    }
    callback(null, true);
  }
});

function hasValidImageSignature(mimeType: string, buffer: Buffer): boolean {
  if (mimeType === "image/png") {
    return buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  }
  if (mimeType === "image/jpeg") {
    return buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
  }
  return mimeType === "image/webp" &&
    buffer.length >= 12 &&
    buffer.toString("ascii", 0, 4) === "RIFF" &&
    buffer.toString("ascii", 8, 12) === "WEBP";
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
    if (user?.password_hash === undefined || !(await bcrypt.compare(input.password, user.password_hash))) {
      throw new ApiError(401, "INVALID_CREDENTIALS", "Email or password is incorrect");
    }
    response.json(authResponse(user, environment.JWT_SECRET));
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

  router.post("/me/avatar", requireAuth, avatarUpload.single("avatar"), async (request, response) => {
    const file = request.file;
    if (file === undefined) {
      throw new ApiError(400, "AVATAR_REQUIRED", "Choose an avatar image to upload");
    }
    const metadata = AvatarFileMetadataSchema.safeParse({
      mimeType: file.mimetype,
      size: file.size
    });
    if (!metadata.success) {
      throw new ApiError(415, "INVALID_AVATAR", "Avatar must be a JPEG, PNG, or WebP image no larger than 2 MB");
    }
    if (!hasValidImageSignature(file.mimetype, file.buffer)) {
      throw new ApiError(415, "INVALID_IMAGE_CONTENT", "Avatar content does not match its image type");
    }

    const extension = allowedImageTypes.get(file.mimetype);
    if (extension === undefined) {
      throw new ApiError(415, "UNSUPPORTED_IMAGE_TYPE", "Avatar must be a JPEG, PNG, or WebP image");
    }
    const key = `${request.auth?.id}/${randomUUID()}.${extension}`;

    let previousKey: string | null = null;
    let avatarUrl: string;
    try {
      const stored = await withTransaction(pool, async (client) => {
        const currentResult = await client.query<{ avatar_object_key: string | null }>(
          "SELECT avatar_object_key FROM users WHERE id = $1 FOR UPDATE",
          [request.auth?.id]
        );
        const current = currentResult.rows[0];
        if (current === undefined) {
          throw new ApiError(401, "UNAUTHORIZED", "The authenticated account no longer exists");
        }
        // SYLLABUS: Buffers and MinIO
        await objectStorage.putObject(environment.MINIO_BUCKET, key, file.buffer, file.size, {
          "Content-Type": file.mimetype,
          "Cache-Control": "private, max-age=900"
        });
        await client.query("UPDATE users SET avatar_object_key = $1 WHERE id = $2", [key, request.auth?.id]);
        return {
          previousKey: current.avatar_object_key,
          avatarUrl: await objectStorage.presignedGetObject(environment.MINIO_BUCKET, key, 15 * 60)
        };
      });
      previousKey = stored.previousKey;
      avatarUrl = stored.avatarUrl;
    } catch (error) {
      try {
        await objectStorage.removeObject(environment.MINIO_BUCKET, key);
      } catch (cleanupError) {
        logger.error({ err: cleanupError, key }, "Failed to remove unreferenced avatar upload");
      }
      throw error;
    }

    if (previousKey !== null && previousKey !== key) {
      try {
        await objectStorage.removeObject(environment.MINIO_BUCKET, previousKey);
      } catch (error) {
        logger.error({ err: error, key: previousKey }, "Failed to remove replaced avatar");
      }
    }
    response.status(201).json(AvatarResponseSchema.parse({ avatarUrl }));
  });

  return router;
}
