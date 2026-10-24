import { Router } from "express";
import {
  OrderSchema,
  OrdersResponseSchema,
  PlaceOrderRequestSchema,
  PlaceOrderResponseSchema,
  TradeQuerySchema
} from "@tradewise/shared";
import type { Pool } from "pg";
import { ApiError } from "../errors.js";
import { validateBody, validateQuery } from "../http-validation.js";
import { authenticate } from "../middleware/authenticate.js";
import { databaseInteger } from "../db/values.js";
import { withTransaction } from "../db/transaction.js";
import { fetchQuotes } from "../market/feed-client.js";
import { executeMarketOrder } from "../engine/matching-engine.js";

interface WalletRow {
  balance_paise: string | number;
}

interface PositionRow {
  symbol: string;
  quantity: string | number;
  average_cost_paise: string | number;
}

interface OrderRow {
  id: string;
  symbol: string;
  side: "buy" | "sell";
  quantity: string | number;
  price_paise: string | number;
  total_paise: string | number;
  created_at: Date;
}

export function createOrdersRouter(pool: Pool, secret: string, feedUrl: string): Router {
  const router = Router();
  const requireAuth = authenticate(secret);

  router.post("/orders", requireAuth, async (request, response) => {
    const input = validateBody(PlaceOrderRequestSchema, request.body);
    const quotes = await fetchQuotes(feedUrl);
    const quote = quotes.find((candidate) => candidate.symbol === input.symbol);
    if (quote === undefined) {
      throw new ApiError(404, "INSTRUMENT_NOT_FOUND", "The requested instrument is not available");
    }

    const userId = request.auth?.id;
    const order = await withTransaction(pool, async (client) => {
      const walletResult = await client.query<WalletRow>(
        "SELECT balance_paise FROM wallets WHERE user_id = $1 FOR UPDATE",
        [userId]
      );
      const wallet = walletResult.rows[0];
      if (wallet === undefined) {
        throw new ApiError(404, "WALLET_NOT_FOUND", "Wallet was not found");
      }

      const positionResult = await client.query<PositionRow>(
        "SELECT symbol, quantity, average_cost_paise FROM positions WHERE user_id = $1 AND symbol = $2 FOR UPDATE",
        [userId, input.symbol]
      );
      const positionRow = positionResult.rows[0];
      const execution = executeMarketOrder(
        input,
        quote.pricePaise,
        databaseInteger(wallet.balance_paise, "wallet balance"),
        positionRow === undefined
          ? null
          : {
              symbol: positionRow.symbol,
              quantity: databaseInteger(positionRow.quantity, "position quantity"),
              averageCostPaise: databaseInteger(positionRow.average_cost_paise, "position cost")
            }
      );

      await client.query(
        "UPDATE wallets SET balance_paise = $1, updated_at = now() WHERE user_id = $2",
        [execution.balancePaise, userId]
      );
      if (execution.position === null) {
        await client.query(
          "DELETE FROM positions WHERE user_id = $1 AND symbol = $2",
          [userId, input.symbol]
        );
      } else {
        await client.query(
          `INSERT INTO positions (user_id, symbol, quantity, average_cost_paise)
           VALUES ($1, $2, $3, $4)
           ON CONFLICT (user_id, symbol) DO UPDATE
           SET quantity = EXCLUDED.quantity, average_cost_paise = EXCLUDED.average_cost_paise`,
          [userId, execution.position.symbol, execution.position.quantity, execution.position.averageCostPaise]
        );
      }

      const insertedOrder = await client.query<OrderRow>(
        `INSERT INTO orders (user_id, symbol, side, quantity, price_paise, total_paise)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING id, symbol, side, quantity, price_paise, total_paise, created_at`,
        [
          userId,
          execution.order.symbol,
          execution.order.side,
          execution.order.quantity,
          execution.order.pricePaise,
          execution.order.totalPaise
        ]
      );
      const row = insertedOrder.rows[0];
      if (row === undefined) {
        throw new Error("Order insert returned no row");
      }
      await client.query(
        `INSERT INTO trades (order_id, user_id, symbol, side, quantity, price_paise, total_paise)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [row.id, userId, row.symbol, row.side, row.quantity, row.price_paise, row.total_paise]
      );
      return OrderSchema.parse({
        id: row.id,
        symbol: row.symbol,
        side: row.side,
        quantity: databaseInteger(row.quantity, "order quantity"),
        pricePaise: databaseInteger(row.price_paise, "order price"),
        totalPaise: databaseInteger(row.total_paise, "order total"),
        status: "filled",
        createdAt: row.created_at.toISOString()
      });
    });

    response.status(201).json(PlaceOrderResponseSchema.parse({ order }));
  });

  router.get("/orders", requireAuth, async (request, response) => {
    const { limit } = validateQuery(TradeQuerySchema, request);
    const result = await pool.query<OrderRow>(
      `SELECT id, symbol, side, quantity, price_paise, total_paise, created_at
       FROM orders
       WHERE user_id = $1
       ORDER BY created_at DESC
       LIMIT $2`,
      [request.auth?.id, limit]
    );
    const orders = result.rows.map((row) => OrderSchema.parse({
      id: row.id,
      symbol: row.symbol,
      side: row.side,
      quantity: databaseInteger(row.quantity, "order quantity"),
      pricePaise: databaseInteger(row.price_paise, "order price"),
      totalPaise: databaseInteger(row.total_paise, "order total"),
      status: "filled",
      createdAt: row.created_at.toISOString()
    }));
    response.json(OrdersResponseSchema.parse({ orders }));
  });

  return router;
}
