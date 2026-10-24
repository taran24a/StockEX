import { createHash, randomUUID } from "node:crypto";
import { Router } from "express";
import {
  OrderRequestSchema,
  OrderResponseSchema,
  OrdersQuerySchema,
  PaginatedOrdersResponseSchema
} from "@tradewise/shared";
import type { OrderRequest, OrdersQuery } from "@tradewise/shared";
import type { Pool, PoolClient } from "pg";
import { z } from "zod";
import { databaseInteger } from "../db/values.js";
import { withTransaction } from "../db/transaction.js";
import { eventBus } from "../events/bus.js";
import { validateBody, validateParams, validateQuery, validatedBody, validatedParams, validatedQuery } from "../http-validation.js";
import { authenticate } from "../middleware/authenticate.js";
import { ConflictError, NotFoundError, UnprocessableEntityError } from "../services/errors.js";
import { OrderBook } from "../engine/order-book.js";
import type { Fill, OrderSide, OrderState } from "../engine/order-book.js";
import { calculateBuyReservation, calculateFillFee } from "../engine/order-finance.js";
import {
  calculatePositionAfterBuy,
  calculatePositionAfterSell
} from "../services/portfolio-calculations.js";

const IdParamsSchema = z.object({ id: z.uuid() });
const IdempotencyKeySchema = z.string().trim().min(1).max(128);

interface AccountRow {
  id: string;
  user_id: string;
  cash_balance: string | number;
  reserved_balance: string | number;
}

interface InstrumentRow {
  id: string;
  symbol: string;
  last_price: string | number;
}

interface RestingOrderRow {
  id: string;
  account_id: string;
  user_id: string;
  symbol: string;
  side: OrderSide;
  type: "limit";
  quantity: string | number;
  filled_quantity: string | number;
  limit_price: string | number;
  reserved_amount: string | number;
  status: "open" | "partially_filled";
  created_at: Date;
}

interface IdempotencyRow {
  request_hash: string;
  response: unknown;
  status_code: number;
}

interface FillEvent {
  fill: Fill;
  fillId: string;
  makerAccountId: string;
  takerAccountId: string;
  makerFeePaise: number;
  takerFeePaise: number;
}

function fingerprint(body: OrderRequest): string {
  const normalized = JSON.stringify(body);
  return createHash("sha256").update(Buffer.from(normalized, "utf8")).digest("hex");
}

interface ApiOrderState extends OrderState {
  accountId: string;
  instrumentId: string;
  idempotencyKey: string | null;
  userId: string;
  reservedAmount: number;
  pendingEvents: Array<{ id: string; aggregateId: string; eventType: string; payload: Record<string, unknown> }>;
}

function encodeOrder(state: ApiOrderState, createdAt: Date | string) {
  const price = state.limitPricePaise ?? 1;
  const total = BigInt(price) * BigInt(state.quantity);
  if (total > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new UnprocessableEntityError("Order notional exceeds the supported integer range", "AMOUNT_OUT_OF_RANGE");
  }
  return OrderResponseSchema.parse({
    id: state.id,
    accountId: state.accountId,
    instrumentId: state.instrumentId,
    symbol: state.symbol,
    side: state.side,
    type: state.type,
    quantity: state.quantity,
    limitPricePaise: state.limitPricePaise ?? null,
    filledQuantity: state.filledQuantity,
    status: state.status,
    idempotencyKey: state.idempotencyKey,
    createdAt: (createdAt instanceof Date ? createdAt : new Date(createdAt)).toISOString(),
    pricePaise: price,
    totalPaise: Number(total)
  });
}

async function recordEvent(
  client: PoolClient,
  aggregateId: string,
  eventType: string,
  payload: Record<string, unknown>,
  requestId: string
): Promise<{ id: string; aggregateId: string; eventType: string; payload: Record<string, unknown> }> {
  const sequence = await client.query<{ next_sequence: string | number }>(
    `SELECT COALESCE(MAX(sequence_number), 0) + 1 AS next_sequence
     FROM domain_events WHERE aggregate_type = 'order' AND aggregate_id = $1`,
    [aggregateId]
  );
  const inserted = await client.query<{ id: string }>(
    `INSERT INTO domain_events
       (aggregate_type, aggregate_id, event_type, sequence_number, payload, request_id)
     VALUES ('order', $1, $2, $3, $4::jsonb, $5)
     RETURNING id`,
    [aggregateId, eventType, sequence.rows[0]?.next_sequence ?? 1, JSON.stringify(payload), requestId]
  );
  const id = inserted.rows[0]?.id;
  if (id === undefined) {
    throw new Error("Domain event insert returned no ID");
  }
  return { id, aggregateId, eventType, payload };
}

async function ledger(
  client: PoolClient,
  accountId: string,
  fillId: string | null,
  type: "reserve" | "release" | "trade_debit" | "trade_credit" | "fee",
  amount: number,
  balanceAfter: number,
  realizedPnlPaise = 0
): Promise<void> {
  if (amount === 0) {
    return;
  }
  const holdingsValue = await client.query<{ market_value: string | number }>(
    `SELECT COALESCE(SUM(position.quantity * instrument.last_price), 0) AS market_value
     FROM positions AS position
     JOIN instruments AS instrument ON instrument.id = position.instrument_id
     WHERE position.account_id = $1`,
    [accountId]
  );
  const equityAfter = safeMoney(
    BigInt(balanceAfter) + BigInt(databaseInteger(holdingsValue.rows[0]?.market_value ?? 0, "holdings market value")),
    "Portfolio equity snapshot"
  );
  await client.query(
    `INSERT INTO ledger_entries
       (account_id, fill_id, entry_type, amount, balance_after, equity_after, realized_pnl_paise)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [accountId, fillId, type, amount, balanceAfter, equityAfter, realizedPnlPaise]
  );
}

function safeMoney(value: bigint, description: string): number {
  if (value < 0n || value > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new UnprocessableEntityError(`${description} exceeds the supported integer range`, "AMOUNT_OUT_OF_RANGE");
  }
  return Number(value);
}

async function updatePosition(
  client: PoolClient,
  accountId: string,
  userId: string,
  instrumentId: string,
  symbol: string,
  side: OrderSide,
  quantity: number,
  pricePaise: number
): Promise<number> {
  const existing = await client.query<{ quantity: string | number; avg_cost: string | number }>(
    `SELECT quantity, avg_cost FROM positions
     WHERE account_id = $1 AND instrument_id = $2 FOR UPDATE`,
    [accountId, instrumentId]
  );
  const row = existing.rows[0];
  if (side === "buy") {
    const nextPosition = calculatePositionAfterBuy(
      row === undefined
        ? null
        : {
            quantity: databaseInteger(row.quantity, "position quantity"),
            averageCostPaise: databaseInteger(row.avg_cost, "position average cost")
          },
      quantity,
      pricePaise
    );
    await client.query(
      `INSERT INTO positions
         (user_id, symbol, quantity, average_cost_paise, account_id, instrument_id, avg_cost)
       VALUES ($1, $2, $3, $4, $5, $6, $4)
       ON CONFLICT (user_id, symbol) DO UPDATE
       SET quantity = EXCLUDED.quantity,
           average_cost_paise = EXCLUDED.average_cost_paise,
           avg_cost = EXCLUDED.avg_cost`,
      [userId, symbol, nextPosition.quantity, nextPosition.averageCostPaise, accountId, instrumentId]
    );
    return 0;
  }

  if (row === undefined || databaseInteger(row.quantity, "position quantity") < quantity) {
    throw new UnprocessableEntityError("Insufficient unreserved shares to fill sell order", "INSUFFICIENT_SHARES");
  }
  const nextPosition = calculatePositionAfterSell({
    quantity: databaseInteger(row.quantity, "position quantity"),
    averageCostPaise: databaseInteger(row.avg_cost, "position average cost")
  }, quantity, pricePaise);
  if (nextPosition.quantity === 0) {
    await client.query("DELETE FROM positions WHERE account_id = $1 AND instrument_id = $2", [accountId, instrumentId]);
  } else {
    await client.query(
      `UPDATE positions
       SET quantity = $3
       WHERE account_id = $1 AND instrument_id = $2`,
      [accountId, instrumentId, nextPosition.quantity]
    );
  }
  return nextPosition.realizedPnlPaise;
}

async function persistOrder(
  client: PoolClient,
  state: ApiOrderState,
  createdAt: Date,
  referencePrice: number,
  requestId: string
): Promise<void> {
  const pricePaise = state.limitPricePaise ?? referencePrice;
  const totalPaise = safeMoney(BigInt(pricePaise) * BigInt(state.quantity), "Order notional");
  await client.query(
    `INSERT INTO orders
       (id, user_id, symbol, side, quantity, price_paise, total_paise, status,
        account_id, instrument_id, type, limit_price, filled_quantity, idempotency_key,
        reserved_amount, cancel_reason, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)`,
    [
      state.id, state.userId, state.symbol, state.side, state.quantity, pricePaise, totalPaise,
      state.status, state.accountId, state.instrumentId, state.type, state.limitPricePaise ?? null,
      state.filledQuantity, state.idempotencyKey, state.reservedAmount, state.reason ?? null, createdAt
    ]
  );
  const accepted = await recordEvent(client, state.id, "ORDER_ACCEPTED", {
    orderId: state.id,
    symbol: state.symbol,
    side: state.side,
    type: state.type,
    quantity: state.quantity
  }, requestId);
  state.pendingEvents.push(accepted);
}

export function createV1OrdersRouter(pool: Pool, secret: string): Router {
  const router = Router();
  const requireAuth = authenticate(secret);

  router.post("/", requireAuth, validateBody(OrderRequestSchema), async (request, response) => {
    const input = validatedBody<OrderRequest>(response);
    const keyResult = IdempotencyKeySchema.safeParse(request.header("Idempotency-Key"));
    if (!keyResult.success) {
      throw new ConflictError("A valid Idempotency-Key header is required", "IDEMPOTENCY_KEY_REQUIRED");
    }
    const key = keyResult.data;
    const requestHash = fingerprint(input);
    const requestId = response.locals.requestId as string;
    const result = await withTransaction(pool, async (client) => {
      const accountLookup = await client.query<{ id: string }>(
        "SELECT id FROM accounts WHERE user_id = $1",
        [request.auth!.id]
      );
      const accountId = accountLookup.rows[0]?.id;
      if (accountId === undefined) {
        throw new NotFoundError("Trading account was not found");
      }

      await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [input.symbol]);
      const accountResult = await client.query<AccountRow>(
        "SELECT id, user_id, cash_balance, reserved_balance FROM accounts WHERE id = $1 FOR UPDATE",
        [accountId]
      );
      const account = accountResult.rows[0];
      if (account === undefined) {
        throw new NotFoundError("Trading account was not found");
      }
      const existingKey = await client.query<IdempotencyRow>(
        "SELECT request_hash, response, status_code FROM idempotency_records WHERE account_id = $1 AND key = $2",
        [accountId, key]
      );
      const previous = existingKey.rows[0];
      if (previous !== undefined) {
        if (previous.request_hash !== requestHash) {
          throw new ConflictError("Idempotency-Key was already used with a different request body", "IDEMPOTENCY_KEY_REUSED");
        }
        return { response: previous.response, statusCode: previous.status_code, events: [], replay: true };
      }

      const instrumentResult = await client.query<InstrumentRow>(
        "SELECT id, symbol, last_price FROM instruments WHERE symbol = $1",
        [input.symbol]
      );
      const instrument = instrumentResult.rows[0];
      if (instrument === undefined) {
        throw new NotFoundError("Instrument was not found");
      }
      const referencePrice = databaseInteger(instrument.last_price, "instrument price");

      const restingResult = await client.query<RestingOrderRow>(
        `SELECT id, account_id, user_id, symbol, side, type, quantity, filled_quantity,
                limit_price, reserved_amount, status, created_at
         FROM orders
         WHERE instrument_id = $1 AND status IN ('open', 'partially_filled')
           AND account_id <> $2
         ORDER BY created_at ASC, id ASC`,
        [instrument.id, accountId]
      );
      const accountIds = [...new Set([accountId, ...restingResult.rows.map((row) => row.account_id)])].sort();
      const lockedAccounts = await client.query<AccountRow>(
        `SELECT id, user_id, cash_balance, reserved_balance
         FROM accounts WHERE id = ANY($1::uuid[]) ORDER BY id FOR UPDATE`,
        [accountIds]
      );
      const balances = new Map(lockedAccounts.rows.map((row) => [row.id, {
        userId: row.user_id,
        cash: databaseInteger(row.cash_balance, "cash balance"),
        reserved: databaseInteger(row.reserved_balance, "reserved balance")
      }]));
      const ledgerBalances = new Map([...balances].map(([id, value]) => [id, BigInt(value.cash)]));
      if (!balances.has(accountId)) {
        throw new NotFoundError("Trading account was not found");
      }

      const book = new OrderBook(input.symbol);
      const restingById = new Map(restingResult.rows.map((row) => [row.id, row]));
      for (const row of restingResult.rows) {
        book.restore({
          id: row.id,
          symbol: row.symbol,
          side: row.side,
          type: row.type,
          quantity: databaseInteger(row.quantity, "resting order quantity"),
          limitPricePaise: databaseInteger(row.limit_price, "resting order limit price")
        }, databaseInteger(row.filled_quantity, "resting order filled quantity"), row.status);
      }

      if (input.side === "sell") {
        const position = await client.query<{ quantity: string | number }>(
          "SELECT quantity FROM positions WHERE account_id = $1 AND instrument_id = $2 FOR UPDATE",
          [accountId, instrument.id]
        );
        const held = databaseInteger(position.rows[0]?.quantity ?? 0, "position quantity");
        const reserved = await client.query<{ quantity: string | number; filled_quantity: string | number }>(
          `SELECT quantity, filled_quantity FROM orders
           WHERE account_id = $1 AND instrument_id = $2 AND side = 'sell'
             AND status IN ('open', 'partially_filled')`,
          [accountId, instrument.id]
        );
        const alreadyReserved = reserved.rows.reduce(
          (sum, row) => sum + databaseInteger(row.quantity, "sell order quantity") -
            databaseInteger(row.filled_quantity, "sell order filled quantity"),
          0
        );
        if (input.quantity > held - alreadyReserved) {
          throw new UnprocessableEntityError("Insufficient unreserved shares", "INSUFFICIENT_SHARES");
        }
      }

      const orderId = randomUUID();
      const matched = book.match({
        id: orderId,
        symbol: input.symbol,
        side: input.side,
        type: input.type,
        quantity: input.quantity,
        ...(input.type === "limit" ? { limitPricePaise: input.limitPricePaise } : {})
      });
      const incomingState = matched.orders.find((order) => order.id === orderId);
      if (incomingState === undefined) {
        throw new Error("Matching engine did not return the incoming order");
      }
      const incomingFills = matched.fills;
      const fillEvents: FillEvent[] = [];
      const orderStates = new Map(matched.orders.map((state) => [state.id, state]));
      const accountCashDelta = new Map<string, bigint>();
      const accountReservationDelta = new Map<string, bigint>();
      const incomingSpend = { total: 0n, fees: 0n };
      const recordedEvents: Array<{ id: string; aggregateId: string; eventType: string; payload: Record<string, unknown> }> = [];
      if (incomingState.side === "buy") {
        for (const fill of incomingFills) {
          incomingSpend.total += BigInt(fill.pricePaise) * BigInt(fill.quantity);
          incomingSpend.fees += calculateFillFee(fill.pricePaise, fill.quantity);
        }
      }
      const incoming = incomingState as ApiOrderState;
      incoming.accountId = accountId;
      incoming.instrumentId = instrument.id;
      incoming.userId = account.user_id;
      incoming.idempotencyKey = key;
      incoming.pendingEvents = [];
      const requiredReserve = incoming.side === "buy" && incoming.type === "limit"
        ? safeMoney(calculateBuyReservation(incoming.remainingQuantity, incoming.limitPricePaise!), "Order reservation")
        : 0;
      const incomingSpendTotal = incomingSpend.total + incomingSpend.fees;
      const currentAccount = balances.get(accountId)!;
      const available = BigInt(currentAccount.cash) - BigInt(currentAccount.reserved);
      if (incomingSpendTotal + BigInt(requiredReserve) > available) {
        throw new UnprocessableEntityError("Insufficient available buying power", "INSUFFICIENT_FUNDS");
      }
      accountReservationDelta.set(accountId, BigInt(requiredReserve));
      incoming.reservedAmount = requiredReserve;
      const createdAt = new Date();
      await persistOrder(client, incoming, createdAt, referencePrice, requestId);
      recordedEvents.push(...incoming.pendingEvents);

      for (const fill of incomingFills) {
        const makerRow = restingById.get(fill.makerOrderId);
        const makerState = orderStates.get(fill.makerOrderId);
        if (makerRow === undefined || makerState === undefined) {
          throw new Error("Matching engine returned an unknown maker order");
        }
        const buyerState = fill.takerOrderId === orderId
          ? incomingState.side === "buy" ? incomingState : makerState
          : makerState.side === "buy" ? makerState : incomingState;
        const sellerState = buyerState.id === incomingState.id ? makerState : incomingState;
        const buyerAccountId = buyerState.id === incomingState.id ? accountId : makerRow.account_id;
        const sellerAccountId = sellerState.id === incomingState.id ? accountId : makerRow.account_id;
        const buyer = balances.get(buyerAccountId);
        const seller = balances.get(sellerAccountId);
        if (buyer === undefined || seller === undefined) {
          throw new Error("Could not load locked accounts for fill");
        }

        const notional = BigInt(fill.pricePaise) * BigInt(fill.quantity);
        const fillNotional = safeMoney(notional, "Fill notional");
        const buyerFee = safeMoney(calculateFillFee(fill.pricePaise, fill.quantity), "Fill fee");
        const sellerFee = buyerFee;
        accountCashDelta.set(buyerAccountId, (accountCashDelta.get(buyerAccountId) ?? 0n) - notional - BigInt(buyerFee));
        accountCashDelta.set(sellerAccountId, (accountCashDelta.get(sellerAccountId) ?? 0n) + notional - BigInt(sellerFee));

        if (buyerState.id !== orderId) {
          const oldReserved = databaseInteger(makerRow.reserved_amount, "maker reservation");
          const nextReserved = safeMoney(
            calculateBuyReservation(makerState.remainingQuantity, makerState.limitPricePaise!),
            "Maker reservation"
          );
          if (nextReserved > oldReserved) {
            throw new UnprocessableEntityError("Maker order reservation is inconsistent", "INVALID_RESERVATION");
          }
          accountReservationDelta.set(buyerAccountId,
            (accountReservationDelta.get(buyerAccountId) ?? 0n) - BigInt(oldReserved - nextReserved));
        }

        await updatePosition(client, buyerAccountId, buyer.userId, instrument.id, input.symbol, "buy", fill.quantity, fill.pricePaise);
        const realizedPnlPaise = await updatePosition(
          client,
          sellerAccountId,
          seller.userId,
          instrument.id,
          input.symbol,
          "sell",
          fill.quantity,
          fill.pricePaise
        );

        const insertedFill = await client.query<{ id: string }>(
          `INSERT INTO fills (order_id, counter_order_id, price, quantity, fee)
           VALUES ($1, $2, $3, $4, $5) RETURNING id`,
          [orderId, makerRow.id, fill.pricePaise, fill.quantity, buyerFee + sellerFee]
        );
        const fillId = insertedFill.rows[0]?.id;
        if (fillId === undefined) {
          throw new Error("Fill insert returned no ID");
        }
        fillEvents.push({
          fill,
          fillId,
          makerAccountId: makerRow.account_id,
          takerAccountId: accountId,
          makerFeePaise: makerState.side === "buy" ? buyerFee : sellerFee,
          takerFeePaise: incomingState.side === "buy" ? buyerFee : sellerFee
        });
        const buyerAfterTrade = safeMoney((ledgerBalances.get(buyerAccountId) ?? BigInt(buyer.cash)) - notional, "Ledger balance");
        ledgerBalances.set(buyerAccountId, BigInt(buyerAfterTrade));
        await ledger(client, buyerAccountId, fillId, "trade_debit", -fillNotional, buyerAfterTrade);
        const sellerAfterTrade = safeMoney((ledgerBalances.get(sellerAccountId) ?? BigInt(seller.cash)) + notional, "Ledger balance");
        ledgerBalances.set(sellerAccountId, BigInt(sellerAfterTrade));
        await ledger(client, sellerAccountId, fillId, "trade_credit", fillNotional, sellerAfterTrade, realizedPnlPaise);
        const buyerAfterFee = safeMoney((ledgerBalances.get(buyerAccountId) ?? BigInt(buyer.cash)) - BigInt(buyerFee), "Ledger balance");
        ledgerBalances.set(buyerAccountId, BigInt(buyerAfterFee));
        await ledger(client, buyerAccountId, fillId, "fee", -buyerFee, buyerAfterFee);
        const sellerAfterFee = safeMoney((ledgerBalances.get(sellerAccountId) ?? BigInt(seller.cash)) - BigInt(sellerFee), "Ledger balance");
        ledgerBalances.set(sellerAccountId, BigInt(sellerAfterFee));
        await ledger(client, sellerAccountId, fillId, "fee", -sellerFee, sellerAfterFee);
      }

      const makerStateRows = matched.orders.filter((state) => state.id !== orderId);
      for (const state of makerStateRows) {
        const maker = restingById.get(state.id);
        if (maker === undefined) {
          throw new Error("Matched maker order does not exist in persistence");
        }
        const reservedAmount = state.side === "buy" && state.status !== "cancelled"
          ? safeMoney(calculateBuyReservation(state.remainingQuantity, state.limitPricePaise!), "Maker reservation")
          : 0;
        await client.query(
          `UPDATE orders SET status = $2, filled_quantity = $3, reserved_amount = $4
           WHERE id = $1`,
          [state.id, state.status, state.filledQuantity, reservedAmount]
        );
        if (state.status !== maker.status) {
          recordedEvents.push(await recordEvent(client, state.id,
            state.status === "filled" ? "ORDER_FILLED" : "ORDER_PARTIALLY_FILLED",
            { orderId: state.id, status: state.status }, requestId));
        }
      }

      await client.query(
        `UPDATE orders SET filled_quantity = $2, status = $3, reserved_amount = $4, cancel_reason = $5
         WHERE id = $1`,
        [incoming.id, incoming.filledQuantity, incoming.status, incoming.reservedAmount, incoming.reason ?? null]
      );

      for (const [id, delta] of accountCashDelta) {
        const prior = balances.get(id)!;
        prior.cash = safeMoney(BigInt(prior.cash) + delta, "Account cash balance");
      }
      for (const [id, delta] of accountReservationDelta) {
        const prior = balances.get(id)!;
        prior.reserved = safeMoney(BigInt(prior.reserved) + delta, "Account reserved balance");
        if (prior.reserved > prior.cash) {
          throw new UnprocessableEntityError("Order would exceed available buying power", "INSUFFICIENT_FUNDS");
        }
      }
      for (const [id, values] of balances) {
        if (!accountCashDelta.has(id) && !accountReservationDelta.has(id)) {
          continue;
        }
        await client.query(
          "UPDATE accounts SET cash_balance = $2, reserved_balance = $3, version = version + 1, updated_at = now() WHERE id = $1",
          [id, values.cash, values.reserved]
        );
      }
      if (requiredReserve > 0) {
        await ledger(client, accountId, null, "reserve", -requiredReserve, currentAccount.cash);
      }
      for (const state of makerStateRows) {
        const maker = restingById.get(state.id)!;
        if (maker.side === "buy") {
          const nextAmount = state.status === "open" || state.status === "partially_filled"
            ? safeMoney(calculateBuyReservation(state.remainingQuantity, state.limitPricePaise!), "Maker reservation")
            : 0;
          const released = databaseInteger(maker.reserved_amount, "maker reservation") - nextAmount;
          if (released > 0) {
            await ledger(client, maker.account_id, null, "release", released,
              balances.get(maker.account_id)?.cash ?? 0);
          }
        }
      }

      for (const fillEvent of fillEvents) {
        const event = await recordEvent(client, orderId, "ORDER_FILLED", {
          orderId,
          fillId: fillEvent.fillId,
          pricePaise: fillEvent.fill.pricePaise,
          quantity: fillEvent.fill.quantity
        }, requestId);
        recordedEvents.push(event);
        const makerState = orderStates.get(fillEvent.fill.makerOrderId);
        recordedEvents.push(await recordEvent(client, fillEvent.fill.makerOrderId,
          makerState?.status === "filled" ? "ORDER_FILLED" : "ORDER_PARTIALLY_FILLED", {
          orderId: fillEvent.fill.makerOrderId,
          fillId: fillEvent.fillId,
          pricePaise: fillEvent.fill.pricePaise,
          quantity: fillEvent.fill.quantity
        }, requestId));
      }
      if (incoming.status === "cancelled") {
        recordedEvents.push(await recordEvent(client, orderId, "ORDER_CANCELLED", {
          orderId, reason: incoming.reason ?? "CANCELLED"
        }, requestId));
      } else if (incoming.status === "open" || incoming.status === "partially_filled") {
        recordedEvents.push(await recordEvent(client, orderId, "ORDER_OPEN", {
          orderId, status: incoming.status
        }, requestId));
      }

      const outputOrder = encodeOrder(incoming, createdAt);
      const output = { order: outputOrder, fills: fillEvents.map(({ fill, fillId }) => ({ id: fillId, ...fill })) };
      await client.query(
        `INSERT INTO idempotency_records (account_id, key, request_hash, response, status_code)
         VALUES ($1, $2, $3, $4::jsonb, 201)`,
        [accountId, key, requestHash, JSON.stringify(output)]
      );
      return { response: output, statusCode: 201, events: recordedEvents, fills: fillEvents, replay: false };
    });

    for (const event of result.events) {
      eventBus.emit("order", event);
    }
    for (const fill of result.fills ?? []) {
      eventBus.emit("fill", fill);
    }
    response.status(result.statusCode).json(result.response);
  });

  router.get("/", requireAuth, validateQuery(OrdersQuerySchema), async (request, response) => {
    const query = validatedQuery<OrdersQuery>(response);
    const clauses = ["user_id = $1"];
    const values: Array<string | number> = [request.auth!.id];
    if (query.symbol !== undefined) {
      values.push(query.symbol);
      clauses.push(`symbol = $${values.length}`);
    }
    if (query.side !== undefined) {
      values.push(query.side);
      clauses.push(`side = $${values.length}`);
    }
    if (query.status !== undefined) {
      values.push(query.status);
      clauses.push(`status = $${values.length}`);
    }
    const where = clauses.join(" AND ");
    const totalResult = await pool.query<{ total: string | number }>(
      `SELECT COUNT(*) AS total FROM orders WHERE ${where}`, values
    );
    values.push(query.limit, query.offset);
    const result = await pool.query(
      `SELECT id, account_id, instrument_id, symbol, side, type, quantity, limit_price,
              filled_quantity, status, idempotency_key, created_at
       FROM orders WHERE ${where}
       ORDER BY created_at DESC, id DESC LIMIT $${values.length - 1} OFFSET $${values.length}`,
      values
    );
    const orders = result.rows.map((row) => OrderResponseSchema.parse({
      id: row.id,
      accountId: row.account_id,
      instrumentId: row.instrument_id,
      symbol: row.symbol,
      side: row.side,
      type: row.type,
      quantity: databaseInteger(row.quantity, "order quantity"),
      limitPricePaise: row.limit_price === null ? null : databaseInteger(row.limit_price, "order limit"),
      filledQuantity: databaseInteger(row.filled_quantity, "order filled quantity"),
      status: row.status,
      idempotencyKey: row.idempotency_key,
      createdAt: new Date(row.created_at).toISOString()
    }));
    response.json(PaginatedOrdersResponseSchema.parse({
      orders,
      pagination: {
        limit: query.limit,
        offset: query.offset,
        total: databaseInteger(totalResult.rows[0]?.total ?? 0, "order count")
      }
    }));
  });

  router.get("/:id", requireAuth, validateParams(IdParamsSchema), async (request, response) => {
    const { id } = validatedParams<z.infer<typeof IdParamsSchema>>(response);
    const result = await pool.query(
      `SELECT id, account_id, instrument_id, symbol, side, type, quantity, limit_price,
              filled_quantity, status, idempotency_key, created_at
       FROM orders WHERE id = $1 AND user_id = $2`,
      [id, request.auth!.id]
    );
    const row = result.rows[0];
    if (row === undefined) {
      throw new NotFoundError("Order was not found");
    }
    response.json(OrderResponseSchema.parse({
      id: row.id,
      accountId: row.account_id,
      instrumentId: row.instrument_id,
      symbol: row.symbol,
      side: row.side,
      type: row.type,
      quantity: databaseInteger(row.quantity, "order quantity"),
      limitPricePaise: row.limit_price === null ? null : databaseInteger(row.limit_price, "order limit"),
      filledQuantity: databaseInteger(row.filled_quantity, "order filled quantity"),
      status: row.status,
      idempotencyKey: row.idempotency_key,
      createdAt: new Date(row.created_at).toISOString()
    }));
  });

  router.post("/:id/cancel", requireAuth, validateParams(IdParamsSchema), async (request, response) => {
    const { id } = validatedParams<z.infer<typeof IdParamsSchema>>(response);
    const requestId = response.locals.requestId as string;
    const result = await withTransaction(pool, async (client) => {
      const lookup = await client.query<{ symbol: string }>(
        "SELECT symbol FROM orders WHERE id = $1 AND user_id = $2",
        [id, request.auth!.id]
      );
      const symbol = lookup.rows[0]?.symbol;
      if (symbol === undefined) {
        throw new NotFoundError("Order was not found");
      }
      await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [symbol]);
      const selected = await client.query<RestingOrderRow>(
        `SELECT id, account_id, user_id, symbol, side, type, quantity, filled_quantity,
                limit_price, reserved_amount, status, created_at
         FROM orders WHERE id = $1 AND user_id = $2 FOR UPDATE`,
        [id, request.auth!.id]
      );
      const order = selected.rows[0];
      if (order === undefined) {
        throw new NotFoundError("Order was not found");
      }
      if (order.status !== "open" && order.status !== "partially_filled") {
        throw new ConflictError("Only open orders can be cancelled", "ORDER_NOT_CANCELLABLE");
      }
      const account = await client.query<AccountRow>(
        "SELECT id, user_id, cash_balance, reserved_balance FROM accounts WHERE id = $1 FOR UPDATE",
        [order.account_id]
      );
      const row = account.rows[0];
      if (row === undefined) {
        throw new NotFoundError("Trading account was not found");
      }
      const reservation = databaseInteger(order.reserved_amount, "order reservation");
      const reservedBalance = databaseInteger(row.reserved_balance, "reserved balance");
      if (reservation > reservedBalance) {
        throw new UnprocessableEntityError("Order reservation is inconsistent", "INVALID_RESERVATION");
      }
      await client.query(
        `UPDATE orders SET status = 'cancelled', reserved_amount = 0, cancel_reason = 'USER_CANCELLED'
         WHERE id = $1`,
        [id]
      );
      await client.query(
        `UPDATE accounts SET reserved_balance = reserved_balance - $2,
         version = version + 1, updated_at = now() WHERE id = $1`,
        [row.id, reservation]
      );
      await ledger(client, row.id, null, "release", reservation, databaseInteger(row.cash_balance, "cash balance"));
      const event = await recordEvent(client, id, "ORDER_CANCELLED", {
        orderId: id, reason: "USER_CANCELLED"
      }, requestId);
      return { event, reservation };
    });
    eventBus.emit("order", result.event);
    response.json({ id, status: "cancelled", releasedReservationPaise: result.reservation });
  });

  return router;
}
