import express from "express";
import cors from "cors";
import { HealthResponseSchema } from "@tradewise/shared";
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

export interface AppDependencies {
  pool: Pool;
  environment: Environment;
  objectStorage: MinioClient;
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
        "/api/v1/auth/register": {
          post: {
            summary: "Register a paper-trading account",
            responses: { "201": { description: "Account created" } }
          }
        },
        "/api/v1/auth/login": {
          post: { summary: "Authenticate an account", responses: { "200": { description: "Authenticated" } } }
        },
        "/api/v1/auth/me": {
          get: { summary: "Get the authenticated profile", responses: { "200": { description: "Profile" } } }
        },
        "/api/v1/auth/logout": {
          post: { summary: "Log out the bearer-token client", responses: { "204": { description: "Logged out" } } }
        },
        "/api/v1/portfolio": {
          get: { summary: "Get virtual cash, holdings, and total equity", responses: { "200": { description: "Portfolio" } } }
        },
        "/api/v1/portfolio/performance": {
          get: { summary: "Get portfolio profit and loss and equity history", responses: { "200": { description: "Portfolio performance" } } }
        },
        "/api/v1/ledger": {
          get: { summary: "Get paginated account ledger entries", responses: { "200": { description: "Ledger entries" } } }
        },
        "/api/v1/risk/rules": {
          get: { summary: "Get account risk rules", responses: { "200": { description: "Risk rules" } } },
          put: { summary: "Update account risk rules", responses: { "200": { description: "Risk rules updated" } } }
        },
        "/api/v1/risk/summary": {
          get: { summary: "Get current risk concentrations and warnings", responses: { "200": { description: "Risk summary" } } }
        },
        "/api/v1/risk/alerts": {
          get: { summary: "Get paginated risk alerts", responses: { "200": { description: "Risk alerts" } } }
        },
        "/api/v1/auth/me/avatar": {
          post: { summary: "Upload a profile avatar", responses: { "201": { description: "Avatar uploaded" } } }
        },
        "/api/quotes": {
          get: { summary: "Get synthetic market quotes", responses: { "200": { description: "Current quotes" } } }
        },
        "/api/market/quotes": {
          get: { summary: "Get current market quotes", responses: { "200": { description: "Current quotes" } } }
        },
        "/api/market/{symbol}": {
          get: { summary: "Get instrument details and quote", responses: { "200": { description: "Instrument and quote" } } }
        },
        "/api/market/{symbol}/candles": {
          get: { summary: "Get aggregated historical candles", responses: { "200": { description: "Candles" } } }
        },
        "/api/watchlists": {
          get: { summary: "List owned watchlists", responses: { "200": { description: "Watchlists" } } },
          post: { summary: "Create a watchlist", responses: { "201": { description: "Watchlist created" } } }
        },
        "/api/watchlists/{watchlistId}": {
          get: { summary: "Get an owned watchlist", responses: { "200": { description: "Watchlist" } } },
          patch: { summary: "Rename an owned watchlist", responses: { "200": { description: "Watchlist updated" } } },
          delete: { summary: "Delete an owned watchlist", responses: { "204": { description: "Watchlist deleted" } } }
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
    app.use("/api/v1/orders", createV1OrdersRouter(pool, environment.JWT_SECRET));
    app.use("/api/v1", createV1PortfolioRouter(pool, environment.JWT_SECRET));
    app.use("/api/v1/risk", createRiskRouter(pool, environment.JWT_SECRET));
    app.use("/api/auth", authRouter);
    app.use("/api/admin", createAdminRouter(pool, environment.JWT_SECRET));
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
