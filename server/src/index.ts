import { createServer } from "node:http";
import { createApp } from "./app.js";
import { loadEnvironment } from "./config.js";
import { createDatabasePool } from "./db/pool.js";
import { logger } from "./logger.js";
import { attachQuoteStream } from "./market/quote-stream.js";
import { createObjectStorage, ensureUploadBucket } from "./storage.js";

const environment = loadEnvironment();
// SYLLABUS: ESM vs CJS
const pool = createDatabasePool(environment);
const objectStorage = createObjectStorage(environment);
const app = createApp({ pool, environment, objectStorage });
const server = createServer(app);
const closeQuoteStream = attachQuoteStream(server, environment.MOCK_FEED_URL);

try {
  await ensureUploadBucket(objectStorage, environment.MINIO_BUCKET);
  server.listen(environment.PORT, () => {
    logger.info({ port: environment.PORT }, "TradeWise API listening");
  });
} catch (error) {
  logger.fatal({ err: error }, "TradeWise API startup dependency initialization failed");
  await pool.end();
  process.exitCode = 1;
}

let isShuttingDown = false;

// SYLLABUS: process/globals
function shutdown(signal: NodeJS.Signals): void {
  if (isShuttingDown) {
    return;
  }
  isShuttingDown = true;
  logger.info({ signal }, "TradeWise API shutting down");
  closeQuoteStream();
  server.close((error) => {
    if (error !== undefined) {
      logger.error({ err: error }, "HTTP server shutdown failed");
    }
    void pool
      .end()
      .then(() => {
        if (error !== undefined) {
          process.exitCode = 1;
        }
      })
      .catch((poolError: unknown) => {
        logger.error({ err: poolError }, "Database pool shutdown failed");
        process.exitCode = 1;
      });
  });
}

process.once("SIGINT", shutdown);
process.once("SIGTERM", shutdown);
