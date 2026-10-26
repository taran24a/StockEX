import dotenv from "dotenv";
import { fileURLToPath } from "node:url";
import { z } from "zod";

// SYLLABUS: fs/path and process/globals
const repositoryEnvironmentFile = fileURLToPath(new URL("../../../.env", import.meta.url));
dotenv.config({ path: process.env.DOTENV_CONFIG_PATH ?? repositoryEnvironmentFile });

export const EnvironmentSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  DATABASE_URL: z.string().url().default("postgres://tradewise:tradewise@localhost:5432/tradewise"),
  JWT_SECRET: z.string().min(32).default("local-development-secret-change-before-deployment"),
  MOCK_FEED_URL: z.string().url().default("http://localhost:4000"),
  OLLAMA_BASE_URL: z.string().url().default("http://localhost:11434"),
  OLLAMA_MODEL: z.string().trim().min(1).max(128).default("llama3.2:3b"),
  CLIENT_ORIGIN: z.string().url().default("http://localhost:5173"),
  GOOGLE_CLIENT_ID: z.string().trim().default(""),
  MINIO_ENDPOINT: z.string().default("localhost"),
  MINIO_PORT: z.coerce.number().int().min(1).max(65535).default(9000),
  MINIO_USE_SSL: z.enum(["true", "false"]).default("false").transform((value) => value === "true"),
  MINIO_ACCESS_KEY: z.string().default("tradewise"),
  MINIO_SECRET_KEY: z.string().min(8).default("tradewise-local"),
  MINIO_BUCKET: z.string().default("tradewise-uploads"),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]).default("info")
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
