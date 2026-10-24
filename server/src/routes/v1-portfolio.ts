import { Router } from "express";
import {
  AccountPortfolioResponseSchema,
  LedgerEntrySchema,
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
import {
  calculateDayChangePaise,
  calculatePortfolio,
  calculatePortfolioPerformance
} from "../services/portfolio-calculations.js";

interface AccountRow {
  id: string;
  cash_balance: string | number;
  reserved_balance: string | number;
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

async function loadAccount(pool: Pool, userId: string): Promise<AccountRow> {
  const result = await pool.query<AccountRow>(
    `SELECT id, cash_balance, reserved_balance
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

  return router;
}
