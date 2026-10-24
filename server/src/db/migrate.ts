import { readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { runner } from "node-pg-migrate";
import { loadEnvironment } from "../config.js";
import { logger } from "../logger.js";

const environment = loadEnvironment();
const direction = process.argv[2] === "down" ? "down" : "up";
// SYLLABUS: fs/path and process/globals
const migrationDirectory = fileURLToPath(new URL("./migrations/", import.meta.url));
const migrationFiles = readdirSync(migrationDirectory)
  .filter((file) => /^\d+.*\.(?:cjs|cts|js|mjs|mts|sql|ts)$/i.test(file))
  .sort();

if (migrationFiles.length === 0) {
  throw new Error(`No migration files found in ${migrationDirectory}`);
}

logger.info({ migrationDirectory, migrationFiles }, "Discovered database migrations");

try {
  await runner({
    databaseUrl: environment.DATABASE_URL,
    dir: migrationDirectory,
    migrationsTable: "pgmigrations",
    direction,
    log: (message) => logger.info(message)
  });
} catch (error) {
  logger.error({ err: error, direction }, "Database migration failed");
  process.exitCode = 1;
}
