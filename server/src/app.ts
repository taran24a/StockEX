import express from "express";
import { fileURLToPath } from "node:url";
import cors from "cors";
import { DatabaseHealthResponseSchema, HealthResponseSchema } from "@tradewise/shared";
import rateLimit from "express-rate-limit";
import helmet from "helmet";
import swaggerUi from "swagger-ui-express";
import { errorHandler } from "./middleware/error-handler.js";
import { requestIdMiddleware } from "./middleware/request-id.js";
import { sanitizeRequest } from "./middleware/sanitize-request.js";
import type { Pool } from "pg";
import type { Environment } from "./config/index.js";
import { ForbiddenError, NotFoundError, TooManyRequestsError } from "./services/errors.js";
import { createAuthRouter } from "./routes/auth.js";
import { createAvatarRouter } from "./routes/avatar.js";
import { createOrdersRouter } from "./routes/orders.js";
import { createPortfolioRouter } from "./routes/portfolio.js";
import { createQuotesRouter } from "./routes/quotes.js";
import { createAdminRouter } from "./routes/admin.js";
import { createMarketRouter } from "./routes/market.js";
import { createWatchlistsRouter } from "./routes/watchlists.js";
import { createV1OrdersRouter } from "./routes/v1-orders.js";
import { createV1PortfolioRouter } from "./routes/v1-portfolio.js";
import { createRiskRouter } from "./routes/risk.js";
import type { Client as MinioClient } from "minio";
import { logger } from "./logger.js";
import type { SimulationControls } from "./services/simulation-controls.js";

export interface AppDependencies {
  pool: Pool;
  environment: Environment;
  objectStorage: MinioClient;
  simulationControls?: SimulationControls;
}

export function createApp(dependencies?: AppDependencies): express.Express {
  const app = express();
  app.disable("x-powered-by");
  app.use(requestIdMiddleware);
  app.use(helmet());
  app.use(cors({
    origin(origin, callback) {
      if (origin === undefined) {
        callback(null, false);
      } else if (dependencies !== undefined && origin === dependencies.environment.CLIENT_ORIGIN) {
        callback(null, origin);
      } else {
        callback(new ForbiddenError("This origin is not allowed", "ORIGIN_NOT_ALLOWED"));
      }
    },
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Authorization", "Content-Type", "X-Request-Id"],
    credentials: true
  }));
  app.use(rateLimit({
    windowMs: 60_000,
    limit: 120,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    handler: (_request, _response, next) => next(new TooManyRequestsError())
  }));
  app.use(express.json({ limit: "32kb" }));
  app.use(sanitizeRequest);

  const healthHandler: express.RequestHandler = (_request, response) => {
    const health = HealthResponseSchema.parse({ status: "ok" });
    response.json(health);
  };

  app.get("/api/v1/health", healthHandler);
  app.get("/api/health", healthHandler);
  app.get("/health", (_request, response) => {
    response.redirect(308, "/api/health");
  });

  const openApiFile = fileURLToPath(new URL("../openapi.yaml", import.meta.url));
  app.get("/api/docs/openapi.yaml", (_request, response, next) => {
    response.type("application/yaml").sendFile(openApiFile, (error) => {
      if (error !== undefined) {
        next(error);
      }
    });
  });
  app.use(
    "/api/docs",
    swaggerUi.serve,
    swaggerUi.setup(undefined, {
      swaggerOptions: { url: "/api/docs/openapi.yaml" }
    })
  );

  if (dependencies !== undefined) {
    const { pool, environment, objectStorage } = dependencies;
    const configuredDatabase = decodeURIComponent(new URL(environment.DATABASE_URL).pathname.slice(1));
    app.get("/api/health/database", async (_request, response) => {
      let result;
      try {
        result = await pool.query<{ database: string }>("SELECT current_database() AS database");
      } catch (error) {
        const code = typeof error === "object" && error !== null && "code" in error
          ? String(error.code)
          : "UNKNOWN";
        logger.warn({ database: configuredDatabase, code }, "Database health check failed");
        response.status(503).json(DatabaseHealthResponseSchema.parse({
          status: "error",
          database: configuredDatabase
        }));
        return;
      }
      const database = result.rows[0]?.database;
      if (database === undefined) {
        logger.warn({ database: configuredDatabase }, "Database health check returned no database name");
        response.status(503).json(DatabaseHealthResponseSchema.parse({
          status: "error",
          database: configuredDatabase
        }));
        return;
      }
      response.json(DatabaseHealthResponseSchema.parse({ status: "ok", database }));
    });
    app.use(
      ["/api/v1/auth", "/api/auth"],
      rateLimit({
        windowMs: 15 * 60_000,
        limit: 20,
        standardHeaders: "draft-8",
        legacyHeaders: false,
        handler: (_request, _response, next) => next(new TooManyRequestsError())
      })
    );
    const authRouter = createAuthRouter(pool, environment, objectStorage);
    app.use("/api/v1/auth", authRouter);
    app.use("/api/v1/users", createAvatarRouter(pool, environment, objectStorage));
    app.use("/api/v1/orders", createV1OrdersRouter(pool, environment.JWT_SECRET));
    app.use("/api/v1", createV1PortfolioRouter(pool, environment.JWT_SECRET));
    app.use("/api/v1/risk", createRiskRouter(pool, environment.JWT_SECRET));
    app.use("/api/auth", authRouter);
    app.use("/api/admin", createAdminRouter(pool, environment.JWT_SECRET, dependencies.simulationControls));
    app.use("/api/market", createMarketRouter(pool, environment.MOCK_FEED_URL));
    app.use("/api/watchlists", createWatchlistsRouter(pool, environment.JWT_SECRET));
    app.use("/api/quotes", createQuotesRouter(environment.MOCK_FEED_URL));
    app.use("/api", createPortfolioRouter(pool, environment.JWT_SECRET, environment.MOCK_FEED_URL));
    app.use("/api", createOrdersRouter(pool, environment.JWT_SECRET, environment.MOCK_FEED_URL));
  }

  app.use((_request, _response, next) => {
    next(new NotFoundError());
  });
  app.use(errorHandler);

  return app;
}

export const app = createApp();
