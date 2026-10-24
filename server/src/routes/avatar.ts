import { randomUUID } from "node:crypto";
import { Router } from "express";
import bcrypt from "bcrypt";
import multer from "multer";
import type { Client as MinioClient } from "minio";
import xss from "xss";
import {
  AvatarFileMetadataSchema,
  AvatarResponseSchema,
  ChangePasswordRequestSchema,
  ProfileDetailsResponseSchema,
  ResetVirtualAccountRequestSchema,
  ResetVirtualAccountResponseSchema,
  UpdateProfileRequestSchema,
  UserSchema
} from "@tradewise/shared";
import type { ChangePasswordRequest, ResetVirtualAccountRequest, UpdateProfileRequest } from "@tradewise/shared";
import type { Pool } from "pg";
import type { Environment } from "../config/index.js";
import { withTransaction } from "../db/transaction.js";
import { authenticate } from "../middleware/authenticate.js";
import { logger } from "../logger.js";
import { ApiError, BadRequestError, ConflictError, NotFoundError, TooManyRequestsError } from "../services/errors.js";
import { validateBody, validatedBody } from "../http-validation.js";
import { databaseInteger } from "../db/values.js";

const allowedImageTypes = new Map([
  ["image/jpeg", "jpg"],
  ["image/png", "png"],
  ["image/webp", "webp"]
]);
const startingVirtualCashPaise = 100_000_000;
const resetCooldownSettingKey = "virtual_account_reset_cooldown_hours";

interface ProfileRow {
  id: string;
  email: string;
  display_name: string;
  role: "user" | "admin";
  avatar_object_key: string | null;
  created_at: Date;
  last_virtual_reset_at: Date | null;
}

interface ResetAccountRow {
  id: string;
  user_id: string;
  cash_balance: string | number;
  reserved_balance: string | number;
  opening_balance: string | number;
  last_virtual_reset_at: Date | null;
}

interface OpenOrderRow {
  id: string;
  reserved_amount: string | number;
}

function cooldownHours(value: unknown): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > 8760) {
    throw new Error("Virtual account reset cooldown setting is invalid");
  }
  return parsed;
}

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

export function createAvatarRouter(
  pool: Pool,
  environment: Environment,
  objectStorage: MinioClient
): Router {
  const router = Router();
  const requireAuth = authenticate(environment.JWT_SECRET);

  router.get("/me", requireAuth, async (request, response) => {
    const result = await pool.query<ProfileRow>(
      `SELECT users.id, users.email, users.display_name, users.role, users.avatar_object_key,
              users.created_at, account.last_virtual_reset_at
       FROM users
       JOIN accounts AS account ON account.user_id = users.id
       WHERE users.id = $1`,
      [request.auth!.id]
    );
    const profile = result.rows[0];
    if (profile === undefined) {
      throw new NotFoundError("Profile or trading account was not found");
    }
    const settingResult = await pool.query<{ value: number | string }>(
      "SELECT value FROM system_settings WHERE key = $1",
      [resetCooldownSettingKey]
    );
    const setting = settingResult.rows[0];
    if (setting === undefined) {
      throw new Error("Virtual account reset cooldown setting is missing");
    }
    const resetCooldown = cooldownHours(setting.value);
    const nextResetAt = profile.last_virtual_reset_at === null
      ? null
      : new Date(profile.last_virtual_reset_at.getTime() + resetCooldown * 60 * 60 * 1000).toISOString();
    const avatarUrl = profile.avatar_object_key === null
      ? null
      : await objectStorage.presignedGetObject(environment.MINIO_BUCKET, profile.avatar_object_key, 15 * 60);
    response.json(ProfileDetailsResponseSchema.parse({
      user: UserSchema.parse({
        id: profile.id,
        email: profile.email,
        displayName: profile.display_name,
        role: profile.role
      }),
      avatarUrl,
      createdAt: profile.created_at.toISOString(),
      resetCooldownHours: resetCooldown,
      lastResetAt: profile.last_virtual_reset_at?.toISOString() ?? null,
      nextResetAt
    }));
  });

  router.patch("/me", requireAuth, validateBody(UpdateProfileRequestSchema), async (request, response) => {
    const input = validatedBody<UpdateProfileRequest>(response);
    const displayName = xss(input.displayName, {
      whiteList: {},
      stripIgnoreTag: true,
      stripIgnoreTagBody: ["script", "style"]
    }).trim();
    if (displayName.length < 2) {
      throw new BadRequestError("Display name must contain at least two visible characters", "VALIDATION_ERROR");
    }
    const result = await pool.query<Pick<ProfileRow, "id" | "email" | "display_name" | "role">>(
      `UPDATE users SET display_name = $1
       WHERE id = $2
       RETURNING id, email, display_name, role`,
      [displayName, request.auth!.id]
    );
    const user = result.rows[0];
    if (user === undefined) {
      throw new NotFoundError("User was not found");
    }
    response.json(UserSchema.parse({
      id: user.id,
      email: user.email,
      displayName: user.display_name,
      role: user.role
    }));
  });

  router.patch("/me/password", requireAuth, validateBody(ChangePasswordRequestSchema), async (request, response) => {
    const input = validatedBody<ChangePasswordRequest>(response);
    if (input.currentPassword === input.newPassword) {
      throw new BadRequestError("New password must be different from the current password", "PASSWORD_UNCHANGED");
    }
    await withTransaction(pool, async (client) => {
      const result = await client.query<{ password_hash: string }>(
        "SELECT password_hash FROM users WHERE id = $1 FOR UPDATE",
        [request.auth!.id]
      );
      const current = result.rows[0];
      if (current === undefined) {
        throw new NotFoundError("User was not found");
      }
      if (!(await bcrypt.compare(input.currentPassword, current.password_hash))) {
        throw new ApiError(400, "CURRENT_PASSWORD_INCORRECT", "Current password is incorrect");
      }
      const passwordHash = await bcrypt.hash(input.newPassword, 12);
      await client.query(
        "UPDATE users SET password_hash = $1 WHERE id = $2",
        [passwordHash, request.auth!.id]
      );
    });
    response.sendStatus(204);
  });

  router.post("/me/reset", requireAuth, validateBody(ResetVirtualAccountRequestSchema), async (request, response) => {
    const input = validatedBody<ResetVirtualAccountRequest>(response);
    ResetVirtualAccountRequestSchema.parse(input);
    const userId = request.auth!.id;
    const result = await withTransaction(pool, async (client) => {
      const accountResult = await client.query<ResetAccountRow>(
        `SELECT id, user_id, cash_balance, reserved_balance, opening_balance, last_virtual_reset_at
         FROM accounts WHERE user_id = $1 FOR UPDATE`,
        [userId]
      );
      const account = accountResult.rows[0];
      if (account === undefined) {
        throw new NotFoundError("Trading account was not found");
      }
      const settingResult = await client.query<{ value: number | string }>(
        "SELECT value FROM system_settings WHERE key = $1",
        [resetCooldownSettingKey]
      );
      const setting = settingResult.rows[0];
      if (setting === undefined) {
        throw new Error("Virtual account reset cooldown setting is missing");
      }
      const hours = cooldownHours(setting.value);
      const now = new Date();
      const nextResetAt = account.last_virtual_reset_at === null
        ? null
        : new Date(account.last_virtual_reset_at.getTime() + hours * 60 * 60 * 1000);
      if (nextResetAt !== null && now < nextResetAt) {
        throw new TooManyRequestsError(
          `Virtual account reset is available after ${nextResetAt.toISOString()}`,
          "RESET_COOLDOWN_ACTIVE"
        );
      }

      const openOrders = await client.query<OpenOrderRow>(
        `SELECT id, reserved_amount FROM orders
         WHERE account_id = $1 AND status IN ('open', 'partially_filled', 'pending')
         FOR UPDATE`,
        [account.id]
      );
      const reservedBalance = databaseInteger(account.reserved_balance, "reserved balance");
      const totalRelease = openOrders.rows.reduce(
        (total, order) => total + databaseInteger(order.reserved_amount, "order reservation"),
        0
      );
      if (totalRelease > reservedBalance) {
        throw new ConflictError("Open order reservations exceed the account reserved balance", "INVALID_RESERVATION");
      }
      for (const order of openOrders.rows) {
        const reservation = databaseInteger(order.reserved_amount, "order reservation");
        await client.query(
          `UPDATE orders
           SET status = 'cancelled', reserved_amount = 0, cancel_reason = 'ACCOUNT_RESET'
           WHERE id = $1`,
          [order.id]
        );
        if (reservation > 0) {
          await client.query(
            `INSERT INTO ledger_entries (account_id, fill_id, entry_type, amount, balance_after)
             VALUES ($1, NULL, 'release', $2, $3)`,
            [account.id, reservation, databaseInteger(account.cash_balance, "cash balance")]
          );
        }
      }

      const positions = await client.query(
        "DELETE FROM positions WHERE account_id = $1",
        [account.id]
      );
      const currentCash = databaseInteger(account.cash_balance, "cash balance");
      const cashAdjustment = startingVirtualCashPaise - currentCash;
      await client.query(
        `INSERT INTO ledger_entries (account_id, fill_id, entry_type, amount, balance_after, created_at)
         VALUES ($1, NULL, 'virtual_reset', $2, $3, clock_timestamp())`,
        [account.id, cashAdjustment, startingVirtualCashPaise]
      );
      await client.query(
        "UPDATE wallets SET balance_paise = $1, updated_at = now() WHERE user_id = $2",
        [startingVirtualCashPaise, account.user_id]
      );
      const updatedAccount = await client.query(
        `UPDATE accounts
         SET cash_balance = $2, reserved_balance = 0, last_virtual_reset_at = clock_timestamp(),
             version = version + 1, updated_at = now()
         WHERE id = $1
         RETURNING last_virtual_reset_at`,
        [account.id, startingVirtualCashPaise]
      );
      const lastResetAt = updatedAccount.rows[0]?.last_virtual_reset_at as Date | undefined;
      if (lastResetAt === undefined) {
        throw new Error("Virtual account reset timestamp was not returned");
      }
      const nextAllowedResetAt = new Date(lastResetAt.getTime() + hours * 60 * 60 * 1000);
      return {
        cashBalancePaise: startingVirtualCashPaise,
        cancelledOrders: openOrders.rowCount ?? openOrders.rows.length,
        clearedPositions: positions.rowCount ?? 0,
        nextResetAt: nextAllowedResetAt.toISOString()
      };
    });
    response.json(ResetVirtualAccountResponseSchema.parse(result));
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
