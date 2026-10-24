import { Router } from "express";
import {
  BalanceResponseSchema,
  PortfolioResponseSchema,
  TradesResponseSchema,
  TradeSchema,
  TradeQuerySchema
} from "@tradewise/shared";
import type { TradeQuery } from "@tradewise/shared";
import type { Pool } from "pg";
import { ApiError } from "../services/errors.js";
import { validatedQuery, validateQuery } from "../http-validation.js";
import { authenticate } from "../middleware/authenticate.js";
import { databaseInteger, safeProduct } from "../db/values.js";
import { fetchQuotes } from "../market/feed-client.js";

interface WalletRow {
  balance_paise: string | number;
}

interface PositionRow {
  symbol: string;
  quantity: string | number;
  average_cost_paise: string | number;
}

interface TradeRow {
  id: string;
  symbol: string;
  side: "buy" | "sell";
  quantity: string | number;
  price_paise: string | number;
  total_paise: string | number;
  created_at: Date;
}

export function createPortfolioRouter(pool: Pool, secret: string, feedUrl: string): Router {
  const router = Router();
  const requireAuth = authenticate(secret);

  router.get("/wallet", requireAuth, async (request, response) => {
    const result = await pool.query<WalletRow>(
      "SELECT balance_paise FROM wallets WHERE user_id = $1",
      [request.auth?.id]
    );
    const wallet = result.rows[0];
    if (wallet === undefined) {
      throw new ApiError(404, "WALLET_NOT_FOUND", "Wallet was not found");
    }
    response.json(BalanceResponseSchema.parse({
      balancePaise: databaseInteger(wallet.balance_paise, "wallet balance")
    }));
  });

  router.get("/portfolio", requireAuth, async (request, response) => {
    const userId = request.auth?.id;
    const [walletResult, positionsResult, quotes] = await Promise.all([
      pool.query<WalletRow>("SELECT balance_paise FROM wallets WHERE user_id = $1", [userId]),
      pool.query<PositionRow>(
        "SELECT symbol, quantity, average_cost_paise FROM positions WHERE user_id = $1 ORDER BY symbol",
        [userId]
      ),
      fetchQuotes(feedUrl)
    ]);
    const wallet = walletResult.rows[0];
    if (wallet === undefined) {
      throw new ApiError(404, "WALLET_NOT_FOUND", "Wallet was not found");
    }
    const quotesBySymbol = new Map(quotes.map((quote) => [quote.symbol, quote]));
    const positions = positionsResult.rows.map((row) => {
      const quote = quotesBySymbol.get(row.symbol);
      if (quote === undefined) {
        throw new ApiError(502, "QUOTE_NOT_FOUND", `The market feed has no quote for ${row.symbol}`);
      }
      const quantity = databaseInteger(row.quantity, "position quantity");
      const averageCostPaise = databaseInteger(row.average_cost_paise, "position cost");
      const marketValuePaise = safeProduct(quantity, quote.pricePaise, "Position market value");
      const costBasis = safeProduct(quantity, averageCostPaise, "Position cost basis");
      const profitLoss = BigInt(marketValuePaise) - BigInt(costBasis);
      if (profitLoss > BigInt(Number.MAX_SAFE_INTEGER) || profitLoss < BigInt(Number.MIN_SAFE_INTEGER)) {
        throw new ApiError(422, "AMOUNT_OUT_OF_RANGE", "Position profit or loss exceeds the supported integer range");
      }
      return {
        symbol: row.symbol,
        quantity,
        averageCostPaise,
        marketValuePaise,
        profitLossPaise: Number(profitLoss)
      };
    });

    response.json(PortfolioResponseSchema.parse({
      balancePaise: databaseInteger(wallet.balance_paise, "wallet balance"),
      positions
    }));
  });

  router.get("/trades", requireAuth, validateQuery(TradeQuerySchema), async (request, response) => {
    // SYLLABUS: route/query params
    const { limit, offset } = validatedQuery<TradeQuery>(response);
    const result = await pool.query<TradeRow>(
      `SELECT id, symbol, side, quantity, price_paise, total_paise, created_at
       FROM trades
       WHERE user_id = $1
       ORDER BY created_at DESC, id DESC
       LIMIT $2 OFFSET $3`,
      [request.auth?.id, limit, offset]
    );
    const trades = result.rows.map((row) => TradeSchema.parse({
      id: row.id,
      symbol: row.symbol,
      side: row.side,
      quantity: databaseInteger(row.quantity, "trade quantity"),
      pricePaise: databaseInteger(row.price_paise, "trade price"),
      totalPaise: databaseInteger(row.total_paise, "trade total"),
      createdAt: row.created_at.toISOString()
    }));
    response.json(TradesResponseSchema.parse({ trades }));
  });

  return router;
}
