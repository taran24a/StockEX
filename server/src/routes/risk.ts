import { Router } from "express";
import {
  RiskAlertsResponseSchema,
  RiskAlertSchema,
  RiskRulesInputSchema,
  RiskRulesSchema,
  RiskSummarySchema,
  TradeQuerySchema
} from "@tradewise/shared";
import type { RiskRulesInput, TradeQuery } from "@tradewise/shared";
import type { Pool } from "pg";
import { databaseInteger } from "../db/values.js";
import { validateBody, validateQuery, validatedBody, validatedQuery } from "../http-validation.js";
import { authenticate } from "../middleware/authenticate.js";
import { NotFoundError } from "../services/errors.js";
import {
  DEFAULT_PRE_TRADE_RISK_RULES,
  findRiskWarnings,
  type ExistingRiskHolding
} from "../services/pre-trade-risk.js";

interface RiskRulesRow {
  id: string;
  account_id: string;
  max_order_notional: string | number;
  max_concentration_pct: string | number;
  max_sector_concentration_pct: string | number;
  created_at: Date;
  updated_at: Date;
}

interface HoldingRow {
  symbol: string;
  sector: string;
  market_value: string | number;
}

interface RiskAlertRow {
  id: string;
  account_id: string;
  rule_id: string | null;
  order_id: string | null;
  alert_type: string;
  severity: "info" | "warning" | "critical";
  message: string;
  details: Record<string, unknown>;
  acknowledged_at: Date | null;
  created_at: Date;
}

function mapRules(row: RiskRulesRow) {
  return RiskRulesSchema.parse({
    accountId: row.account_id,
    maxOrderNotionalPaise: databaseInteger(row.max_order_notional, "maximum order notional"),
    maxSingleStockConcentrationPct: Number(row.max_concentration_pct),
    maxSectorConcentrationPct: Number(row.max_sector_concentration_pct),
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString()
  });
}

async function getAccountId(pool: Pool, userId: string): Promise<string> {
  const result = await pool.query<{ id: string }>("SELECT id FROM accounts WHERE user_id = $1", [userId]);
  const accountId = result.rows[0]?.id;
  if (accountId === undefined) {
    throw new NotFoundError("Trading account was not found");
  }
  return accountId;
}

async function ensureRules(pool: Pool, accountId: string): Promise<RiskRulesRow> {
  const result = await pool.query<RiskRulesRow>(
    `INSERT INTO risk_rules
       (account_id, max_order_notional, max_concentration_pct, max_sector_concentration_pct)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (account_id) DO UPDATE SET account_id = EXCLUDED.account_id
     RETURNING id, account_id, max_order_notional, max_concentration_pct,
               max_sector_concentration_pct, created_at, updated_at`,
    [
      accountId,
      DEFAULT_PRE_TRADE_RISK_RULES.maxOrderNotionalPaise,
      DEFAULT_PRE_TRADE_RISK_RULES.maxSingleStockConcentrationPct,
      DEFAULT_PRE_TRADE_RISK_RULES.maxSectorConcentrationPct
    ]
  );
  const row = result.rows[0];
  if (row === undefined) {
    throw new Error("Risk rules could not be loaded");
  }
  return row;
}

export function createRiskRouter(pool: Pool, secret: string): Router {
  const router = Router();
  const requireAuth = authenticate(secret);

  router.get("/rules", requireAuth, async (request, response) => {
    const accountId = await getAccountId(pool, request.auth!.id);
    response.json(mapRules(await ensureRules(pool, accountId)));
  });

  router.put("/rules", requireAuth, validateBody(RiskRulesInputSchema), async (request, response) => {
    const input = validatedBody<RiskRulesInput>(response);
    const accountId = await getAccountId(pool, request.auth!.id);
    const result = await pool.query<RiskRulesRow>(
      `INSERT INTO risk_rules
         (account_id, max_order_notional, max_concentration_pct, max_sector_concentration_pct)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (account_id) DO UPDATE
       SET max_order_notional = EXCLUDED.max_order_notional,
           max_concentration_pct = EXCLUDED.max_concentration_pct,
           max_sector_concentration_pct = EXCLUDED.max_sector_concentration_pct,
           updated_at = now()
       RETURNING id, account_id, max_order_notional, max_concentration_pct,
                 max_sector_concentration_pct, created_at, updated_at`,
      [
        accountId,
        input.maxOrderNotionalPaise,
        input.maxSingleStockConcentrationPct,
        input.maxSectorConcentrationPct
      ]
    );
    const row = result.rows[0];
    if (row === undefined) {
      throw new Error("Updated risk rules were not returned");
    }
    response.json(mapRules(row));
  });

  router.get("/summary", requireAuth, async (request, response) => {
    const accountId = await getAccountId(pool, request.auth!.id);
    const [rulesRow, accountResult, holdingsResult] = await Promise.all([
      ensureRules(pool, accountId),
      pool.query<{ cash_balance: string | number }>(
        "SELECT cash_balance FROM accounts WHERE id = $1",
        [accountId]
      ),
      pool.query<HoldingRow>(
        `SELECT instrument.symbol, instrument.sector,
                SUM(position.quantity * instrument.last_price) AS market_value
         FROM positions AS position
         JOIN instruments AS instrument ON instrument.id = position.instrument_id
         WHERE position.account_id = $1
         GROUP BY instrument.symbol, instrument.sector
         ORDER BY instrument.symbol`,
        [accountId]
      )
    ]);
    const cashBalance = accountResult.rows[0]?.cash_balance;
    if (cashBalance === undefined) {
      throw new NotFoundError("Trading account was not found");
    }
    const rules = mapRules(rulesRow);
    const holdings: ExistingRiskHolding[] = holdingsResult.rows.map((row) => ({
      symbol: row.symbol,
      sector: row.sector,
      marketValuePaise: databaseInteger(row.market_value, "holding market value")
    }));
    const totalEquityPaise = databaseInteger(cashBalance, "cash balance") +
      holdings.reduce((total, holding) => total + holding.marketValuePaise, 0);
    const sectorValues = new Map<string, number>();
    for (const holding of holdings) {
      sectorValues.set(holding.sector, (sectorValues.get(holding.sector) ?? 0) + holding.marketValuePaise);
    }
    response.json(RiskSummarySchema.parse({
      accountId,
      totalEquityPaise,
      singleStocks: holdings.map((holding) => ({
        name: holding.symbol,
        sector: holding.sector,
        marketValuePaise: holding.marketValuePaise,
        concentrationPct: totalEquityPaise === 0
          ? 0
          : holding.marketValuePaise / totalEquityPaise * 100
      })),
      sectors: [...sectorValues].map(([name, marketValuePaise]) => ({
        name,
        marketValuePaise,
        concentrationPct: totalEquityPaise === 0
          ? 0
          : marketValuePaise / totalEquityPaise * 100
      })),
      warnings: findRiskWarnings(holdings, totalEquityPaise, {
        maxOrderNotionalPaise: rules.maxOrderNotionalPaise,
        maxSingleStockConcentrationPct: rules.maxSingleStockConcentrationPct,
        maxSectorConcentrationPct: rules.maxSectorConcentrationPct
      })
    }));
  });

  router.get("/alerts", requireAuth, validateQuery(TradeQuerySchema), async (request, response) => {
    const { limit, offset } = validatedQuery<TradeQuery>(response);
    const accountId = await getAccountId(pool, request.auth!.id);
    const [alertsResult, totalResult] = await Promise.all([
      pool.query<RiskAlertRow>(
        `SELECT id, account_id, rule_id, order_id, alert_type, severity, message,
                details, acknowledged_at, created_at
         FROM risk_alerts WHERE account_id = $1
         ORDER BY created_at DESC, id DESC
         LIMIT $2 OFFSET $3`,
        [accountId, limit, offset]
      ),
      pool.query<{ total: string | number }>(
        "SELECT COUNT(*) AS total FROM risk_alerts WHERE account_id = $1",
        [accountId]
      )
    ]);
    response.json(RiskAlertsResponseSchema.parse({
      alerts: alertsResult.rows.map((row) => RiskAlertSchema.parse({
        id: row.id,
        accountId: row.account_id,
        ruleId: row.rule_id,
        orderId: row.order_id,
        alertType: row.alert_type,
        severity: row.severity,
        message: row.message,
        details: row.details,
        acknowledgedAt: row.acknowledged_at?.toISOString() ?? null,
        createdAt: row.created_at.toISOString()
      })),
      pagination: {
        limit,
        offset,
        total: databaseInteger(totalResult.rows[0]?.total ?? 0, "risk alert count")
      }
    }));
  });

  return router;
}
