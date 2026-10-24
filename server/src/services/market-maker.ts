import { randomUUID } from "node:crypto";
import type { Pool } from "pg";
import { eventBus } from "../events/bus.js";
import { databaseInteger } from "../db/values.js";
import { withTransaction } from "../db/transaction.js";
import { logger } from "../logger.js";
import { calculateBuyReservation } from "../engine/order-finance.js";
import type { SimulationControls } from "./simulation-controls.js";

const BOT_EMAIL = "liquidity-bot@tradewise.internal";
const ORDER_QUANTITY = 100;

interface InstrumentRow {
  id: string;
  symbol: string;
  last_price: string | number;
}

interface BotAccountRow {
  id: string;
  user_id: string;
  cash_balance: string | number;
  reserved_balance: string | number;
}

interface EventRow {
  id: string;
  aggregateId: string;
  eventType: string;
  payload: Record<string, unknown>;
}

export function startMarketMaker(
  pool: Pool,
  intervalMs = 5_000,
  simulationControls?: SimulationControls
): () => void {
  let running = false;
  let stopped = false;
  let paused = false;

  const tick = async (): Promise<void> => {
    if (running || stopped || paused) {
      return;
    }
    running = true;
    try {
      const instruments = await pool.query<InstrumentRow>(
        "SELECT id, symbol, last_price FROM instruments ORDER BY symbol"
      );
      for (const instrument of instruments.rows) {
        const events = await withTransaction(pool, async (client) => {
          await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [instrument.symbol]);
          const botResult = await client.query<BotAccountRow>(
            `SELECT accounts.id, accounts.user_id, accounts.cash_balance, accounts.reserved_balance
             FROM accounts JOIN users ON users.id = accounts.user_id
             WHERE users.email = $1 FOR UPDATE OF accounts`,
            [BOT_EMAIL]
          );
          const bot = botResult.rows[0];
          if (bot === undefined) {
            throw new Error("Dedicated market-maker account is missing; run npm run seed");
          }

          const openOrders = await client.query<{ side: "buy" | "sell" }>(
            `SELECT side FROM orders
             WHERE account_id = $1 AND instrument_id = $2 AND status IN ('open', 'partially_filled')`,
            [bot.id, instrument.id]
          );
          const present = new Set(openOrders.rows.map((row) => row.side));
          const currentPrice = databaseInteger(instrument.last_price, "market-maker reference price");
          const spread = Math.max(1, Math.floor(currentPrice / 1_000));
          const bid = Math.max(1, currentPrice - spread);
          const ask = currentPrice + spread;
          const opposing = await client.query<{ side: "buy" | "sell"; limit_price: string | number }>(
            `SELECT side, limit_price FROM orders
             WHERE instrument_id = $1 AND account_id <> $2 AND status IN ('open', 'partially_filled')
             ORDER BY created_at, id`,
            [instrument.id, bot.id]
          );
          const bestAsk = opposing.rows
            .filter((row) => row.side === "sell")
            .reduce<number | undefined>((best, row) => {
              const price = databaseInteger(row.limit_price, "market ask");
              return best === undefined || price < best ? price : best;
            }, undefined);
          const bestBid = opposing.rows
            .filter((row) => row.side === "buy")
            .reduce<number | undefined>((best, row) => {
              const price = databaseInteger(row.limit_price, "market bid");
              return best === undefined || price > best ? price : best;
            }, undefined);
          const newEvents: EventRow[] = [];

          const createRestingOrder = async (
            side: "buy" | "sell",
            price: number,
            reservation: number
          ): Promise<void> => {
            const id = randomUUID();
            await client.query(
              `INSERT INTO orders
                 (id, user_id, symbol, side, quantity, price_paise, total_paise, status,
                  account_id, instrument_id, type, limit_price, filled_quantity, reserved_amount)
               VALUES ($1, $2, $3, $4, $5, $6, $7, 'open', $8, $9, 'limit', $6, 0, $10)`,
              [id, bot.user_id, instrument.symbol, side, ORDER_QUANTITY,
                price, price * ORDER_QUANTITY, bot.id, instrument.id, reservation]
            );
            const eventResult = await client.query<{ id: string }>(
              `INSERT INTO domain_events
                 (aggregate_type, aggregate_id, event_type, sequence_number, payload)
               VALUES ('order', $1, 'ORDER_ACCEPTED', 1, $2::jsonb)
               RETURNING id`,
              [id, JSON.stringify({ orderId: id, side, symbol: instrument.symbol, source: "market-maker" })]
            );
            const eventId = eventResult.rows[0]?.id;
            if (eventId !== undefined) {
              newEvents.push({
                id: eventId,
                aggregateId: id,
                eventType: "ORDER_ACCEPTED",
                payload: { orderId: id, side, symbol: instrument.symbol, source: "market-maker" }
              });
            }
          };

          const availableCash = databaseInteger(bot.cash_balance, "market-maker cash") -
            databaseInteger(bot.reserved_balance, "market-maker reserved cash");
          const bidReservationBigInt = calculateBuyReservation(ORDER_QUANTITY, bid);
          if (bidReservationBigInt > BigInt(Number.MAX_SAFE_INTEGER)) {
            throw new Error("Market-maker bid reservation exceeds the safe integer range");
          }
          const bidReservation = Number(bidReservationBigInt);
          if (!present.has("buy") && (bestAsk === undefined || bid < bestAsk) && availableCash >= bidReservation) {
            await createRestingOrder("buy", bid, bidReservation);
            await client.query(
              `UPDATE accounts SET reserved_balance = reserved_balance + $2,
               version = version + 1, updated_at = now() WHERE id = $1`,
              [bot.id, bidReservation]
            );
            await client.query(
              `INSERT INTO ledger_entries (account_id, entry_type, amount, balance_after)
               VALUES ($1, 'reserve', $2, $3)`,
              [bot.id, -bidReservation, bot.cash_balance]
            );
          }

          if (!present.has("sell") && (bestBid === undefined || ask > bestBid)) {
            const heldResult = await client.query<{ quantity: string | number }>(
              "SELECT quantity FROM positions WHERE account_id = $1 AND instrument_id = $2 FOR UPDATE",
              [bot.id, instrument.id]
            );
            const reservedResult = await client.query<{ reserved: string | number }>(
              `SELECT COALESCE(SUM(quantity - filled_quantity), 0) AS reserved
               FROM orders WHERE account_id = $1 AND instrument_id = $2 AND side = 'sell'
                 AND status IN ('open', 'partially_filled')`,
              [bot.id, instrument.id]
            );
            const held = databaseInteger(heldResult.rows[0]?.quantity ?? 0, "market-maker inventory");
            const reserved = databaseInteger(reservedResult.rows[0]?.reserved ?? 0, "market-maker reserved inventory");
            if (held - reserved >= ORDER_QUANTITY) {
              await createRestingOrder("sell", ask, 0);
            }
          }
          return newEvents;
        });
        for (const event of events) {
          eventBus.emit("order", event);
        }
      }
    } catch (error) {
      logger.error({ err: error }, "Market-maker replenishment failed");
    } finally {
      running = false;
    }
  };

  const timer = setInterval(() => void tick(), intervalMs);
  const unregister = simulationControls?.register("marketMaker", (nextPaused) => {
    paused = nextPaused;
    if (!paused) void tick();
  });
  void tick();
  return () => {
    stopped = true;
    clearInterval(timer);
    unregister?.();
  };
}
