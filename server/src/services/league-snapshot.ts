import type { Pool, PoolClient } from "pg";
import { logger } from "../logger.js";
import { withTransaction } from "../db/transaction.js";

const liquidityBotEmail = "liquidity-bot@tradewise.internal";
const defaultResetBalancePaise = 100_000_000;
const snapshotRetentionDays = 90;

interface CurrentAccountRow {
  id: string;
  equity_paise: string | number;
  contributed_capital_paise: string | number;
  last_reset_at: Date | null;
}

interface SnapshotRow {
  equity_paise: string | number;
}

export interface LeaguePerformance {
  returnPct: number;
  maxDrawdownPct: number;
  riskAdjustedScore: number;
}

function integer(value: string | number, label: string): bigint {
  const parsed = typeof value === "number" ? String(value) : value;
  if (!/^-?\d+$/.test(parsed)) {
    throw new TypeError(`${label} is not an integer`);
  }
  return BigInt(parsed);
}

function percent(numerator: bigint, denominator: bigint): number {
  return Number((numerator * 1_000_000n) / denominator) / 10_000;
}

export function calculateLeaguePerformance(
  contributedCapitalPaise: bigint,
  currentEquityPaise: bigint,
  history: bigint[]
): LeaguePerformance {
  if (contributedCapitalPaise <= 0n) {
    throw new RangeError("Contributed capital must be positive");
  }
  const returnPct = percent(currentEquityPaise - contributedCapitalPaise, contributedCapitalPaise);
  let peak = contributedCapitalPaise;
  let maxDrawdownPct = 0;
  for (const equity of history) {
    if (equity > peak) peak = equity;
    if (peak > 0n) {
      maxDrawdownPct = Math.max(maxDrawdownPct, percent(peak - equity, peak));
    }
  }
  const riskAdjustedScore = Math.round((returnPct / Math.max(maxDrawdownPct, 1)) * 10_000) / 10_000;
  return { returnPct, maxDrawdownPct, riskAdjustedScore };
}

async function snapshotAccounts(client: PoolClient): Promise<void> {
  const accounts = await client.query<CurrentAccountRow>(
    `SELECT account.id,
            account.cash_balance + COALESCE(position_values.market_value, 0) AS equity_paise,
            CASE WHEN reset.last_reset_at IS NOT NULL THEN $1::numeric
                 ELSE GREATEST(account.opening_balance + COALESCE(capital.net_contributions, 0), 0)
            END AS contributed_capital_paise,
            reset.last_reset_at
     FROM accounts AS account
     JOIN users ON users.id = account.user_id
     LEFT JOIN LATERAL (
       SELECT SUM(position.quantity * instrument.last_price) AS market_value
       FROM positions AS position
       JOIN instruments AS instrument ON instrument.id = position.instrument_id
       WHERE position.account_id = account.id
     ) AS position_values ON true
     LEFT JOIN LATERAL (
       SELECT SUM(entry.amount) AS net_contributions
       FROM ledger_entries AS entry
       WHERE entry.account_id = account.id
         AND entry.entry_type IN ('deposit', 'withdrawal')
     ) AS capital ON true
     LEFT JOIN LATERAL (
       SELECT MAX(entry.created_at) AS last_reset_at
       FROM ledger_entries AS entry
       WHERE entry.account_id = account.id AND entry.entry_type = 'virtual_reset'
     ) AS reset ON true
     WHERE users.email <> $2
     ORDER BY account.id`,
    [defaultResetBalancePaise, liquidityBotEmail]
  );

  for (const account of accounts.rows) {
    const equity = integer(account.equity_paise, "Current equity");
    const capital = integer(account.contributed_capital_paise, "Contributed capital");
    await client.query(
      "INSERT INTO league_equity_snapshots (account_id, equity_paise) VALUES ($1, $2)",
      [account.id, equity.toString()]
    );
    if (capital <= 0n) {
      await client.query("DELETE FROM league_rankings WHERE account_id = $1", [account.id]);
      continue;
    }

    const historyResult = await client.query<SnapshotRow>(
      `SELECT equity_paise FROM league_equity_snapshots
       WHERE account_id = $1
         AND observed_at >= COALESCE($2::timestamptz, now() - ($3::int * interval '1 day'))
       ORDER BY observed_at ASC, id ASC`,
      [account.id, account.last_reset_at, snapshotRetentionDays]
    );
    const history = historyResult.rows.map((snapshot) => integer(snapshot.equity_paise, "Equity snapshot"));
    const performance = calculateLeaguePerformance(capital, equity, history);
    await client.query(
      `INSERT INTO league_rankings
         (account_id, current_equity_paise, return_pct, max_drawdown_pct, risk_adjusted_score, updated_at)
       VALUES ($1, $2, $3, $4, $5, now())
       ON CONFLICT (account_id) DO UPDATE
       SET current_equity_paise = EXCLUDED.current_equity_paise,
           return_pct = EXCLUDED.return_pct,
           max_drawdown_pct = EXCLUDED.max_drawdown_pct,
           risk_adjusted_score = EXCLUDED.risk_adjusted_score,
           updated_at = EXCLUDED.updated_at`,
      [
        account.id,
        equity.toString(),
        performance.returnPct,
        performance.maxDrawdownPct,
        performance.riskAdjustedScore
      ]
    );
  }

  await client.query(
    `DELETE FROM league_equity_snapshots
     WHERE observed_at < now() - ($1::int * interval '1 day')`,
    [snapshotRetentionDays]
  );
}

export function startLeagueSnapshotJob(pool: Pool, intervalMs = 60_000): () => void {
  let stopped = false;
  let running = false;

  const refresh = async (): Promise<void> => {
    if (stopped || running) return;
    running = true;
    try {
      await withTransaction(pool, snapshotAccounts);
    } catch (error) {
      logger.error({ err: error }, "League leaderboard refresh failed");
    } finally {
      running = false;
    }
  };

  const timer = setInterval(() => void refresh(), intervalMs);
  void refresh();
  return () => {
    stopped = true;
    clearInterval(timer);
  };
}
