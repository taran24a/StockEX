import express from "express";
import jwt from "jsonwebtoken";
import type { Client as MinioClient } from "minio";
import type { Pool } from "pg";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";
import { loadEnvironment } from "../config/index.js";
import { errorHandler } from "../middleware/error-handler.js";
import { createAvatarRouter } from "./avatar.js";

const secret = "test-secret-long-enough-for-the-avatar-routes";
const userId = "4b8fbe96-52f4-45b9-a373-195af22bcf22";
const environment = loadEnvironment({ JWT_SECRET: secret });

function avatarApp(pool: Pool, objectStorage: MinioClient) {
  const app = express();
  app.use("/api/v1/users", createAvatarRouter(pool, environment, objectStorage));
  app.use(errorHandler);
  return app;
}

describe("avatar route", () => {
  it("rejects non-image uploads before touching MinIO or the database", async () => {
    const token = jwt.sign({ role: "user" }, secret, { subject: userId, expiresIn: "1h" });
    const query = vi.fn();
    const putObject = vi.fn();
    const pool = { query, connect: vi.fn() } as unknown as Pool;
    const storage = { putObject } as unknown as MinioClient;
    const response = await request(avatarApp(pool, storage))
      .post("/api/v1/users/me/avatar")
      .set("Authorization", `Bearer ${token}`)
      .attach("avatar", Buffer.from("not an image"), { filename: "avatar.txt", contentType: "text/plain" });

    expect(response.status).toBe(415);
    expect(response.body.error.code).toBe("UNSUPPORTED_IMAGE_TYPE");
    expect(putObject).not.toHaveBeenCalled();
    expect(query).not.toHaveBeenCalled();
  });
});
