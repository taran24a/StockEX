import express from "express";
import { HealthResponseSchema } from "@tradewise/shared";
import rateLimit from "express-rate-limit";
import swaggerUi from "swagger-ui-express";
import { errorHandler } from "./middleware/error-handler.js";
import type { Pool } from "pg";
import type { Environment } from "./config.js";
import { ApiError } from "./errors.js";
import { createAuthRouter } from "./routes/auth.js";
import { createOrdersRouter } from "./routes/orders.js";
import { createPortfolioRouter } from "./routes/portfolio.js";
import { createQuotesRouter } from "./routes/quotes.js";
import { createAdminRouter } from "./routes/admin.js";
import type { Client as MinioClient } from "minio";

export interface AppDependencies {
  pool: Pool;
  environment: Environment;
  objectStorage: MinioClient;
}

export function createApp(dependencies?: AppDependencies): express.Express {
  const app = express();
  app.disable("x-powered-by");
  app.use(express.json({ limit: "32kb" }));
  app.use(rateLimit({ windowMs: 60_000, limit: 120, standardHeaders: "draft-8", legacyHeaders: false }));

  const healthHandler: express.RequestHandler = (_request, response) => {
    const health = HealthResponseSchema.parse({ status: "ok" });
    response.json(health);
  };

  app.get("/api/v1/health", healthHandler);
  app.get("/api/health", healthHandler);
  app.get("/health", (_request, response) => {
    response.redirect(308, "/api/health");
  });

  app.use(
    "/api/docs",
    swaggerUi.serve,
    swaggerUi.setup({
      openapi: "3.1.0",
      info: { title: "TradeWise API", version: "1.0.0" },
      paths: {
        "/api/v1/health": {
          get: { summary: "Check API health", responses: { "200": { description: "API is healthy" } } }
        },
        "/api/health": {
          get: { summary: "Check API health (legacy)", responses: { "200": { description: "API is healthy" } } }
        },
        "/api/auth/register": {
          post: {
            summary: "Register a paper-trading account",
            responses: { "201": { description: "Account created" } }
          }
        },
        "/api/auth/login": {
          post: { summary: "Authenticate an account", responses: { "200": { description: "Authenticated" } } }
        },
        "/api/auth/me": {
          get: { summary: "Get the authenticated profile", responses: { "200": { description: "Profile" } } }
        },
        "/api/auth/me/avatar": {
          post: { summary: "Upload a profile avatar", responses: { "201": { description: "Avatar uploaded" } } }
        },
        "/api/quotes": {
          get: { summary: "Get synthetic market quotes", responses: { "200": { description: "Current quotes" } } }
        },
        "/api/orders": {
          get: { summary: "List filled paper orders", responses: { "200": { description: "Orders" } } },
          post: { summary: "Place a paper market order", responses: { "201": { description: "Filled order" } } }
        },
        "/api/wallet": {
          get: { summary: "Get virtual cash balance", responses: { "200": { description: "Wallet balance" } } }
        },
        "/api/portfolio": {
          get: { summary: "Get portfolio positions", responses: { "200": { description: "Portfolio" } } }
        },
        "/api/trades": { get: { summary: "Get trade history", responses: { "200": { description: "Trades" } } } },
        "/api/admin/users": {
          get: {
            summary: "List users (admin only)",
            responses: { "200": { description: "User list" }, "403": { description: "Forbidden" } }
          }
        }
      }
    })
  );

  if (dependencies !== undefined) {
    const { pool, environment, objectStorage } = dependencies;
    app.use((request, response, next) => {
      const origin = request.header("origin");
      if (origin !== undefined && origin !== environment.CLIENT_ORIGIN) {
        next(new ApiError(403, "ORIGIN_NOT_ALLOWED", "This origin is not allowed"));
        return;
      }
      if (origin !== undefined) {
        response.setHeader("Access-Control-Allow-Origin", origin);
        response.setHeader("Vary", "Origin");
        response.setHeader("Access-Control-Allow-Headers", "Authorization, Content-Type");
        response.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
      }
      if (request.method === "OPTIONS") {
        response.sendStatus(204);
        return;
      }
      next();
    });
    app.use(
      "/api/auth",
      rateLimit({ windowMs: 15 * 60_000, limit: 20, standardHeaders: "draft-8", legacyHeaders: false })
    );
    app.use("/api/auth", createAuthRouter(pool, environment, objectStorage));
    app.use("/api/admin", createAdminRouter(pool, environment.JWT_SECRET));
    app.use("/api/quotes", createQuotesRouter(environment.MOCK_FEED_URL));
    app.use("/api", createPortfolioRouter(pool, environment.JWT_SECRET, environment.MOCK_FEED_URL));
    app.use("/api", createOrdersRouter(pool, environment.JWT_SECRET, environment.MOCK_FEED_URL));
  }

  app.use((_request, _response, next) => {
    next(new ApiError(404, "NOT_FOUND", "The requested resource was not found"));
  });
  app.use(errorHandler);

  return app;
}

export const app = createApp();
