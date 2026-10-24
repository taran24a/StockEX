import pino from "pino";

// SYLLABUS: logging
export const logger = pino({
  level: process.env.LOG_LEVEL ?? "info",
  redact: ["req.headers.authorization", "password", "password_hash"]
});
