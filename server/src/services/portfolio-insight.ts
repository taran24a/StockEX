import type { Pool } from "pg";
import { databaseInteger } from "../db/values.js";
import { NotFoundError } from "./errors.js";
import type { PortfolioInsightMetrics } from "@tradewise/shared";

interface InsightAccountRow {
  id: string;
  cash_balance: string | number;
  contributed_capital: string | number;
}

interface InsightHoldingRow {
  symbol: string;
  quantity: string | number;
  avg_cost: string | number;
  last_price: string | number;
  previous_close: string | number | null;
}

function checkedInteger(value: bigint, label: string): number {
  if (value > BigInt(Number.MAX_SAFE_INTEGER) || value < BigInt(Number.MIN_SAFE_INTEGER)) {
    throw new RangeError(`${label} exceeds the supported integer range`);
  }
  return Number(value);
}

export async function calculatePortfolioInsight(pool: Pool, userId: string): Promise<PortfolioInsightMetrics> {
  const accountResult = await pool.query<InsightAccountRow>(
    `SELECT account.id, account.cash_balance,
            GREATEST(account.opening_balance + COALESCE((
              SELECT SUM(entry.amount)
              FROM ledger_entries AS entry
              WHERE entry.account_id = account.id
                AND entry.entry_type IN ('deposit', 'withdrawal')
            ), 0), 0) AS contributed_capital
     FROM accounts AS account
     WHERE account.user_id = $1`,
    [userId]
  );
  const account = accountResult.rows[0];
  if (account === undefined) {
    throw new NotFoundError("Trading account was not found");
  }

  const [holdingsResult, realizedResult] = await Promise.all([
    pool.query<InsightHoldingRow>(
      `SELECT instrument.symbol, position.quantity, position.avg_cost, instrument.last_price,
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
      [account.id]
    ),
    pool.query<{ realized_pnl: string | number }>(
      "SELECT COALESCE(SUM(realized_pnl_paise), 0) AS realized_pnl FROM ledger_entries WHERE account_id = $1",
      [account.id]
    )
  ]);

  let holdingsMarketValue = 0n;
  let unrealizedPnl = 0n;
  let dayChange = 0n;
  const holdings = holdingsResult.rows.map((row) => {
    const quantity = BigInt(databaseInteger(row.quantity, "position quantity"));
    const averageCost = BigInt(databaseInteger(row.avg_cost, "average cost"));
    const marketPrice = BigInt(databaseInteger(row.last_price, "market price"));
    const previousClose = row.previous_close === null
      ? marketPrice
      : BigInt(databaseInteger(row.previous_close, "previous close"));
    const marketValue = quantity * marketPrice;
    const positionUnrealizedPnl = marketValue - quantity * averageCost;
    const dayChangeContribution = quantity * (marketPrice - previousClose);
    holdingsMarketValue += marketValue;
    unrealizedPnl += positionUnrealizedPnl;
    dayChange += dayChangeContribution;
    return {
      symbol: row.symbol,
      marketValuePaise: checkedInteger(marketValue, "Holding market value"),
      unrealizedPnlPaise: checkedInteger(positionUnrealizedPnl, "Holding unrealized P&L"),
      dayChangeContributionPaise: checkedInteger(dayChangeContribution, "Holding day-change contribution")
    };
  });

  const cashBalancePaise = databaseInteger(account.cash_balance, "cash balance");
  const totalEquityPaise = checkedInteger(BigInt(cashBalancePaise) + holdingsMarketValue, "Portfolio equity");
  const contributedCapitalPaise = databaseInteger(account.contributed_capital, "contributed capital");
  const realizedPnlPaise = databaseInteger(realizedResult.rows[0]?.realized_pnl ?? 0, "realized P&L");

  return {
    totalEquityPaise,
    cashBalancePaise,
    contributedCapitalPaise,
    returnPct: contributedCapitalPaise === 0
      ? null
      : Number((((BigInt(totalEquityPaise) - BigInt(contributedCapitalPaise)) * 10_000n) / BigInt(contributedCapitalPaise))) / 100,
    realizedPnlPaise,
    unrealizedPnlPaise: checkedInteger(unrealizedPnl, "Portfolio unrealized P&L"),
    dayChangePaise: checkedInteger(dayChange, "Portfolio day change"),
    holdings
  };
}

export function numericOnlyInsightInput(metrics: PortfolioInsightMetrics): Record<string, unknown> {
  const numericMetrics: Record<string, number | number[]> = {
    totalEquityPaise: metrics.totalEquityPaise,
    cashBalancePaise: metrics.cashBalancePaise,
    contributedCapitalPaise: metrics.contributedCapitalPaise,
    realizedPnlPaise: metrics.realizedPnlPaise,
    unrealizedPnlPaise: metrics.unrealizedPnlPaise,
    dayChangePaise: metrics.dayChangePaise,
    holdingCount: metrics.holdings.length
  };
  if (metrics.returnPct !== null) {
    numericMetrics.returnPct = metrics.returnPct;
  }
  return {
    ...numericMetrics,
    holdings: metrics.holdings.map((holding, index) => ({
      index: index + 1,
      marketValuePaise: holding.marketValuePaise,
      unrealizedPnlPaise: holding.unrealizedPnlPaise,
      dayChangeContributionPaise: holding.dayChangeContributionPaise
    }))
  };
}

export function deterministicPortfolioExplanation(metrics: PortfolioInsightMetrics): {
  explanation: string;
  highlights: string[];
} {
  const returnSummary = metrics.returnPct === null
    ? "A return percentage is unavailable because no contributed-capital baseline is recorded."
    : `Portfolio return versus contributed capital is ${metrics.returnPct.toFixed(2)}%.`;
  const daySummary = metrics.dayChangePaise > 0
    ? `Today's holding-price movement contributes ${metrics.dayChangePaise} paise positively.`
    : metrics.dayChangePaise < 0
      ? `Today's holding-price movement contributes ${Math.abs(metrics.dayChangePaise)} paise negatively.`
      : "Today's holding-price movement contributes 0 paise.";
  const highlights = [
    `${metrics.holdings.length} current holdings; equity ${metrics.totalEquityPaise} paise.`,
    returnSummary,
    `Realized P&L ${metrics.realizedPnlPaise} paise; unrealized P&L ${metrics.unrealizedPnlPaise} paise.`,
    daySummary
  ];
  return {
    explanation: `${returnSummary} ${daySummary} These figures describe recorded portfolio values and are not trading advice.`,
    highlights
  };
}
