import { Router } from "express";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import {
  AccountPortfolioResponseSchema,
  LedgerEntrySchema,
  PortfolioVerifyResponseSchema,
  PaginatedLedgerResponseSchema,
  PortfolioPerformanceResponseSchema,
  TradeQuerySchema
} from "@tradewise/shared";
import type { TradeQuery } from "@tradewise/shared";
import type { Pool } from "pg";
import { databaseInteger } from "../db/values.js";
import { validateQuery, validatedQuery } from "../http-validation.js";
import { authenticate } from "../middleware/authenticate.js";
import { NotFoundError } from "../services/errors.js";
import { logger } from "../logger.js";
import {
  calculateDayChangePaise,
  calculatePortfolio,
  calculatePortfolioPerformance
} from "../services/portfolio-calculations.js";
import {
  rebuildPortfolioFromLedger
} from "../services/portfolio-replay.js";
import type {
  ReplayFill,
  ReplayLedgerEntry
} from "../services/portfolio-replay.js";

interface AccountRow {
  id: string;
  cash_balance: string | number;
  reserved_balance: string | number;
  opening_balance: string | number;
}

interface HoldingRow {
  instrument_id: string;
  symbol: string;
  quantity: string | number;
  avg_cost: string | number;
  last_price: string | number;
  previous_close: string | number | null;
}

interface LedgerRow {
  id: string;
  account_id: string;
  fill_id: string | null;
  entry_type: "deposit" | "withdrawal" | "reserve" | "release" | "trade_debit" | "trade_credit" | "fee";
  amount: string | number;
  balance_after: string | number;
  created_at: Date;
}

interface EquitySnapshotRow {
  created_at: Date;
  equity_after: string | number;
}

interface RebuildLedgerRow {
  fill_id: string | null;
  entry_type: ReplayLedgerEntry["entryType"];
  amount: string | number;
}

interface RebuildFillRow {
  id: string;
  symbol: string;
  side: "buy" | "sell";
  quantity: string | number;
  price: string | number;
  executed_at: Date;
  execution_sequence: string | number;
}

interface LivePositionRow {
  symbol: string;
  quantity: string | number;
  avg_cost: string | number;
}

interface TradeStatementRow {
  id: string;
  executed_at: Date;
  symbol: string;
  side: "buy" | "sell";
  quantity: string | number;
  price: string | number;
  fee: string | number;
}

const statementBatchSize = 500;

function csvCell(value: string | number): string {
  return `"${String(value).replaceAll('"', '""')}"`;
}

async function* tradeStatement(pool: Pool, accountId: string): AsyncGenerator<string> {
  yield "executed_at,symbol,side,quantity,price_paise,fee_paise\r\n";
  let cursor: { executedAt: Date; id: string } | undefined;
  while (true) {
    const cursorFilter = cursor === undefined
      ? ""
      : "WHERE (trade.executed_at, trade.id) > ($2, $3)";
    const limitParameter = cursor === undefined ? "$2" : "$4";
    const values = cursor === undefined
      ? [accountId, statementBatchSize]
      : [accountId, cursor.executedAt, cursor.id, statementBatchSize];
    const result = await pool.query<TradeStatementRow>(
      `SELECT trade.id, trade.executed_at, trade.symbol, trade.side, trade.quantity, trade.price,
              COALESCE((
                SELECT ABS(SUM(ledger.amount))
                FROM ledger_entries AS ledger
                WHERE ledger.account_id = $1
                  AND ledger.fill_id = trade.id
                  AND ledger.entry_type = 'fee'
              ), 0) AS fee
       FROM (
         SELECT fill.id, fill.executed_at, instrument.symbol, own_order.side,
                fill.quantity, fill.price
         FROM fills AS fill
         JOIN orders AS own_order ON own_order.id = fill.order_id
         JOIN instruments AS instrument ON instrument.id = own_order.instrument_id
         WHERE own_order.account_id = $1
         UNION ALL
         SELECT fill.id, fill.executed_at, instrument.symbol, counter_order.side,
                fill.quantity, fill.price
         FROM fills AS fill
         JOIN orders AS counter_order ON counter_order.id = fill.counter_order_id
         JOIN instruments AS instrument ON instrument.id = counter_order.instrument_id
         WHERE counter_order.account_id = $1
       ) AS trade
       ${cursorFilter}
       ORDER BY trade.executed_at ASC, trade.id ASC
       LIMIT ${limitParameter}`,
      values
    );
    if (result.rows.length === 0) {
      return;
    }
    for (const row of result.rows) {
      yield [
        csvCell(row.executed_at.toISOString()),
        csvCell(row.symbol),
        csvCell(row.side),
        csvCell(databaseInteger(row.quantity, "trade quantity")),
        csvCell(databaseInteger(row.price, "trade price")),
        csvCell(databaseInteger(row.fee, "trade fee"))
      ].join(",") + "\r\n";
    }
    const lastRow = result.rows.at(-1);
    if (lastRow === undefined || result.rows.length < statementBatchSize) {
      return;
    }
    cursor = { executedAt: lastRow.executed_at, id: lastRow.id };
  }
}

async function loadAccount(pool: Pool, userId: string): Promise<AccountRow> {
  const result = await pool.query<AccountRow>(
    `SELECT id, cash_balance, reserved_balance, opening_balance
     FROM accounts WHERE user_id = $1`,
    [userId]
  );
  const account = result.rows[0];
  if (account === undefined) {
    throw new NotFoundError("Trading account was not found");
  }
  return account;
}

async function loadHoldings(pool: Pool, accountId: string): Promise<HoldingRow[]> {
  const result = await pool.query<HoldingRow>(
    `SELECT instrument.id AS instrument_id,
            instrument.symbol,
            position.quantity,
            position.avg_cost,
            instrument.last_price,
            previous.close AS previous_close
     FROM positions AS position
     JOIN instruments AS instrument ON instrument.id = position.instrument_id
     LEFT JOIN LATERAL (
       SELECT candle.close
       FROM candles AS candle
       WHERE candle.instrument_id = instrument.id
         AND candle.ts < date_trunc('day', now())
       ORDER BY candle.ts DESC
       LIMIT 1
     ) AS previous ON true
     WHERE position.account_id = $1
     ORDER BY instrument.symbol`,
    [accountId]
  );
  return result.rows;
}

function mapHolding(row: HoldingRow) {
  return {
    instrumentId: row.instrument_id,
    symbol: row.symbol,
    quantity: databaseInteger(row.quantity, "position quantity"),
    averageCostPaise: databaseInteger(row.avg_cost, "position average cost"),
    marketPricePaise: databaseInteger(row.last_price, "instrument last price"),
    dayChangePaise: calculateDayChangePaise(
      databaseInteger(row.last_price, "instrument last price"),
      row.previous_close === null
        ? null
        : databaseInteger(row.previous_close, "previous candle close")
    )
  };
}

export function createV1PortfolioRouter(pool: Pool, secret: string): Router {
  const router = Router();
  const requireAuth = authenticate(secret);

  router.get("/portfolio", requireAuth, async (request, response) => {
    const account = await loadAccount(pool, request.auth!.id);
    const rows = await loadHoldings(pool, account.id);
    const cashBalancePaise = databaseInteger(account.cash_balance, "cash balance");
    const reservedBalancePaise = databaseInteger(account.reserved_balance, "reserved balance");
    const portfolio = calculatePortfolio(
      cashBalancePaise,
      reservedBalancePaise,
      rows.map(mapHolding)
    );

    response.json(AccountPortfolioResponseSchema.parse({
      accountId: account.id,
      cashBalancePaise,
      reservedBalancePaise,
      holdings: portfolio.holdings,
      totalEquityPaise: portfolio.totalEquityPaise
    }));
  });

  router.get("/portfolio/statement.csv", requireAuth, async (request, response) => {
    const account = await loadAccount(pool, request.auth!.id);
    response.setHeader("Content-Type", "text/csv; charset=utf-8");
    response.setHeader("Content-Disposition", 'attachment; filename="tradewise-trade-statement.csv"');
    const stream = Readable.from(tradeStatement(pool, account.id));
    void pipeline(stream, response).catch((error: unknown) => {
      logger.error({ err: error, accountId: account.id }, "Trade statement stream failed");
      if (!response.destroyed) {
        response.destroy(error instanceof Error ? error : undefined);
      }
    });
  });

  router.get("/portfolio/performance", requireAuth, async (request, response) => {
    const account = await loadAccount(pool, request.auth!.id);
    const [holdingRows, realizedResult, snapshotResult] = await Promise.all([
      loadHoldings(pool, account.id),
      pool.query<{ realized_pnl_paise: string | number }>(
        `SELECT realized_pnl_paise
         FROM ledger_entries WHERE account_id = $1 AND realized_pnl_paise <> 0`,
        [account.id]
      ),
      pool.query<EquitySnapshotRow>(
        `SELECT created_at, COALESCE(equity_after, balance_after) AS equity_after
         FROM (
           SELECT id, created_at, equity_after, balance_after
           FROM ledger_entries
           WHERE account_id = $1
           ORDER BY created_at DESC, id DESC
           LIMIT 500
         ) AS snapshots
         ORDER BY created_at ASC, id ASC`,
        [account.id]
      )
    ]);
    const performance = calculatePortfolioPerformance(
      realizedResult.rows.map((row) => databaseInteger(row.realized_pnl_paise, "realized P&L")),
      holdingRows.map(mapHolding),
      snapshotResult.rows.map((snapshot) => ({
        timestamp: snapshot.created_at,
        equityPaise: databaseInteger(snapshot.equity_after, "equity snapshot")
      }))
    );
    response.json(PortfolioPerformanceResponseSchema.parse(performance));
  });

  router.get("/ledger", requireAuth, validateQuery(TradeQuerySchema), async (request, response) => {
    const { limit, offset } = validatedQuery<TradeQuery>(response);
    const account = await loadAccount(pool, request.auth!.id);
    const [entriesResult, countResult] = await Promise.all([
      pool.query<LedgerRow>(
        `SELECT id, account_id, fill_id, entry_type, amount, balance_after, created_at
         FROM ledger_entries
         WHERE account_id = $1
         ORDER BY created_at DESC, id DESC
         LIMIT $2 OFFSET $3`,
        [account.id, limit, offset]
      ),
      pool.query<{ total: number | string }>(
        "SELECT COUNT(*)::int AS total FROM ledger_entries WHERE account_id = $1",
        [account.id]
      )
    ]);
    const entries = entriesResult.rows.map((row) => LedgerEntrySchema.parse({
      id: row.id,
      accountId: row.account_id,
      fillId: row.fill_id,
      entryType: row.entry_type,
      amountPaise: databaseInteger(row.amount, "ledger amount"),
      balanceAfterPaise: databaseInteger(row.balance_after, "ledger balance"),
      createdAt: row.created_at.toISOString()
    }));
    const total = databaseInteger(countResult.rows[0]?.total ?? 0, "ledger entry count");
    response.json(PaginatedLedgerResponseSchema.parse({
      entries,
      pagination: { limit, offset, total }
    }));
  });

  router.get("/portfolio/verify", requireAuth, async (request, response) => {
    const account = await loadAccount(pool, request.auth!.id);
    const [ledgerResult, fillsResult, livePositionsResult] = await Promise.all([
      pool.query<RebuildLedgerRow>(
        `SELECT fill_id, entry_type, amount
         FROM ledger_entries
         WHERE account_id = $1
         ORDER BY created_at ASC, id ASC`,
        [account.id]
      ),
      pool.query<RebuildFillRow>(
        `SELECT fill.id, instrument.symbol, own_order.side, fill.quantity, fill.price,
                fill.executed_at, fill.execution_sequence
         FROM fills AS fill
         JOIN orders AS own_order ON own_order.id = fill.order_id
         JOIN instruments AS instrument ON instrument.id = own_order.instrument_id
         WHERE own_order.account_id = $1
         UNION ALL
         SELECT fill.id, instrument.symbol, counter_order.side, fill.quantity, fill.price,
                fill.executed_at, fill.execution_sequence
         FROM fills AS fill
         JOIN orders AS counter_order ON counter_order.id = fill.counter_order_id
         JOIN instruments AS instrument ON instrument.id = counter_order.instrument_id
         WHERE counter_order.account_id = $1
         ORDER BY executed_at ASC, id ASC`,
        [account.id]
      ),
      pool.query<LivePositionRow>(
        `SELECT instrument.symbol, position.quantity, position.avg_cost
         FROM positions AS position
         JOIN instruments AS instrument ON instrument.id = position.instrument_id
         WHERE position.account_id = $1
         ORDER BY instrument.symbol`,
        [account.id]
      )
    ]);
    const ledgerEntries: ReplayLedgerEntry[] = ledgerResult.rows.map((entry) => ({
      fillId: entry.fill_id,
      entryType: entry.entry_type,
      amountPaise: databaseInteger(entry.amount, "ledger amount")
    }));
    const fills: ReplayFill[] = fillsResult.rows.map((fill) => ({
      id: fill.id,
      symbol: fill.symbol,
      side: fill.side,
      quantity: databaseInteger(fill.quantity, "fill quantity"),
      pricePaise: databaseInteger(fill.price, "fill price"),
      executedAt: fill.executed_at,
      executionSequence: databaseInteger(fill.execution_sequence, "fill execution sequence")
    }));
    const rebuilt = rebuildPortfolioFromLedger(
      ledgerEntries,
      fills,
      databaseInteger(account.opening_balance, "account opening balance")
    );
    const liveCash = databaseInteger(account.cash_balance, "cash balance");
    const liveReserved = databaseInteger(account.reserved_balance, "reserved balance");
    const liveHoldings = new Map(livePositionsResult.rows.map((position) => [
      position.symbol,
      {
        quantity: databaseInteger(position.quantity, "position quantity"),
        averageCostPaise: databaseInteger(position.avg_cost, "position average cost")
      }
    ]));
    const rebuiltHoldings = new Map(rebuilt.holdings.map((position) => [position.symbol, position]));
    const symbols = [...new Set([...liveHoldings.keys(), ...rebuiltHoldings.keys()])].sort();
    const differences: Array<{ field: string; live: unknown; rebuilt: unknown }> = [];
    if (liveCash !== rebuilt.cashBalancePaise) {
      differences.push({
        field: "cashBalancePaise",
        live: liveCash,
        rebuilt: rebuilt.cashBalancePaise
      });
    }
    if (liveReserved !== rebuilt.reservedBalancePaise) {
      differences.push({
        field: "reservedBalancePaise",
        live: liveReserved,
        rebuilt: rebuilt.reservedBalancePaise
      });
    }
    for (const symbol of symbols) {
      const live = liveHoldings.get(symbol);
      const reconstructed = rebuiltHoldings.get(symbol);
      if (live?.quantity !== reconstructed?.quantity) {
        differences.push({
          field: `holdings.${symbol}.quantity`,
          live: live?.quantity ?? 0,
          rebuilt: reconstructed?.quantity ?? 0
        });
      }
      if (live?.averageCostPaise !== reconstructed?.averageCostPaise) {
        differences.push({
          field: `holdings.${symbol}.averageCostPaise`,
          live: live?.averageCostPaise ?? 0,
          rebuilt: reconstructed?.averageCostPaise ?? 0
        });
      }
    }
    response.json(PortfolioVerifyResponseSchema.parse({
      match: differences.length === 0,
      differences
    }));
  });

  return router;
}
