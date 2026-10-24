import dotenv from "dotenv";
import { resolve } from "node:path";
import { z } from "zod";

// SYLLABUS: fs/path and process/globals
dotenv.config({ path: process.env.DOTENV_CONFIG_PATH ?? resolve(process.cwd(), "../.env") });

const EnvironmentSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  DATABASE_URL: z.string().url().default("postgres://tradewise:tradewise@localhost:5432/tradewise"),
  JWT_SECRET: z.string().min(32).default("local-development-secret-change-before-deployment"),
  MOCK_FEED_URL: z.string().url().default("http://localhost:4000"),
  CLIENT_ORIGIN: z.string().url().default("http://localhost:5173"),
  MINIO_ENDPOINT: z.string().default("localhost"),
  MINIO_PORT: z.coerce.number().int().min(1).max(65535).default(9000),
  MINIO_USE_SSL: z.enum(["true", "false"]).default("false").transform((value) => value === "true"),
  MINIO_ACCESS_KEY: z.string().default("tradewise"),
  MINIO_SECRET_KEY: z.string().min(8).default("tradewise-local"),
  MINIO_BUCKET: z.string().default("tradewise-uploads")
});

export type Environment = z.infer<typeof EnvironmentSchema>;

export function loadEnvironment(source: NodeJS.ProcessEnv = process.env): Environment {
  const parsed = EnvironmentSchema.safeParse(source);
  if (!parsed.success) {
    throw new Error(`Invalid environment configuration: ${parsed.error.message}`);
  }
  if (parsed.data.NODE_ENV === "production" && parsed.data.JWT_SECRET === "local-development-secret-change-before-deployment") {
    throw new Error("JWT_SECRET must be configured in production");
  }
  return parsed.data;
}
