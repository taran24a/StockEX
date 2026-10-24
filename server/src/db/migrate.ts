import { runner } from "node-pg-migrate";
import { loadEnvironment } from "../config.js";
import { logger } from "../logger.js";

const environment = loadEnvironment();
const direction = process.argv[2] === "down" ? "down" : "up";

try {
  await runner({
    databaseUrl: environment.DATABASE_URL,
    dir: "src/db/migrations",
    migrationsTable: "pgmigrations",
    direction,
    log: (message) => logger.info(message)
  });
} catch (error) {
  logger.error({ err: error, direction }, "Database migration failed");
  process.exitCode = 1;
}
