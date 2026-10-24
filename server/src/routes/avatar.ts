import { randomUUID } from "node:crypto";
import { Router } from "express";
import multer from "multer";
import type { Client as MinioClient } from "minio";
import {
  AvatarFileMetadataSchema,
  AvatarResponseSchema
} from "@tradewise/shared";
import type { Pool } from "pg";
import type { Environment } from "../config/index.js";
import { withTransaction } from "../db/transaction.js";
import { authenticate } from "../middleware/authenticate.js";
import { logger } from "../logger.js";
import { ApiError } from "../services/errors.js";

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

export function createAvatarRouter(
  pool: Pool,
  environment: Environment,
  objectStorage: MinioClient
): Router {
  const router = Router();
  const requireAuth = authenticate(environment.JWT_SECRET);

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
