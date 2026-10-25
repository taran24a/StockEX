import { Router } from "express";
import rateLimit from "express-rate-limit";
import { LeagueResponseSchema, TradeQuerySchema } from "@tradewise/shared";
import type { TradeQuery } from "@tradewise/shared";
import type { Pool } from "pg";
import { databaseInteger } from "../db/values.js";
import { validateQuery, validatedQuery } from "../http-validation.js";
import { authenticate } from "../middleware/authenticate.js";

interface LeagueEntryRow {
  rank: string | number;
  display_name: string;
  current_equity_paise: string | number;
  return_pct: string | number;
  max_drawdown_pct: string | number;
  risk_adjusted_score: string | number;
  updated_at: Date;
}

export function createLeagueRouter(pool: Pool, secret: string): Router {
  const router = Router();
  router.use(authenticate(secret));
  router.get(
    "/",
    rateLimit({
      windowMs: 60_000,
      limit: 60,
      standardHeaders: "draft-8",
      legacyHeaders: false,
      keyGenerator: (request) => request.auth!.id
    }),
    validateQuery(TradeQuerySchema),
    async (_request, response) => {
      const { limit, offset } = validatedQuery<TradeQuery>(response);
      const [entriesResult, countResult] = await Promise.all([
        pool.query<LeagueEntryRow>(
          `WITH ranked AS (
             SELECT ROW_NUMBER() OVER (
                      ORDER BY ranking.risk_adjusted_score DESC, ranking.return_pct DESC,
                               ranking.max_drawdown_pct ASC, ranking.account_id ASC
                    ) AS rank,
                    users.display_name, ranking.current_equity_paise, ranking.return_pct,
                    ranking.max_drawdown_pct, ranking.risk_adjusted_score, ranking.updated_at
             FROM league_rankings AS ranking
             JOIN accounts AS account ON account.id = ranking.account_id
             JOIN users ON users.id = account.user_id
             WHERE users.email <> 'liquidity-bot@tradewise.internal'
           )
           SELECT rank, display_name, current_equity_paise, return_pct,
                  max_drawdown_pct, risk_adjusted_score, updated_at
           FROM ranked
           ORDER BY rank
           LIMIT $1 OFFSET $2`,
          [limit, offset]
        ),
        pool.query<{ total: string | number }>(
          `SELECT COUNT(*)::bigint AS total
           FROM league_rankings AS ranking
           JOIN accounts AS account ON account.id = ranking.account_id
           JOIN users ON users.id = account.user_id
           WHERE users.email <> 'liquidity-bot@tradewise.internal'`
        )
      ]);
      response.json(LeagueResponseSchema.parse({
        entries: entriesResult.rows.map((row) => ({
          rank: databaseInteger(row.rank, "leaderboard rank"),
          displayName: row.display_name,
          currentEquityPaise: databaseInteger(row.current_equity_paise, "leaderboard equity"),
          returnPct: Number(row.return_pct),
          maxDrawdownPct: Number(row.max_drawdown_pct),
          riskAdjustedScore: Number(row.risk_adjusted_score),
          updatedAt: row.updated_at.toISOString()
        })),
        pagination: {
          limit,
          offset,
          total: databaseInteger(countResult.rows[0]?.total ?? 0, "leaderboard size")
        }
      }));
    }
  );
  return router;
}
