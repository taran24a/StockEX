import type { MigrationBuilder } from "node-pg-migrate";

export async function up(pgm: MigrationBuilder): Promise<void> {
  pgm.createTable("league_equity_snapshots", {
    id: { type: "bigserial", primaryKey: true },
    account_id: { type: "uuid", notNull: true, references: "accounts", onDelete: "CASCADE" },
    equity_paise: { type: "numeric(20,0)", notNull: true, check: "equity_paise >= 0" },
    observed_at: { type: "timestamptz", notNull: true, default: pgm.func("now()") }
  });
  pgm.createIndex("league_equity_snapshots", ["account_id", { name: "observed_at", sort: "DESC" }], {
    name: "league_equity_snapshots_account_observed_idx"
  });

  pgm.createTable("league_rankings", {
    account_id: { type: "uuid", primaryKey: true, references: "accounts", onDelete: "CASCADE" },
    current_equity_paise: { type: "numeric(20,0)", notNull: true, check: "current_equity_paise >= 0" },
    return_pct: { type: "numeric(20,8)", notNull: true },
    max_drawdown_pct: { type: "numeric(8,4)", notNull: true, check: "max_drawdown_pct BETWEEN 0 AND 100" },
    risk_adjusted_score: { type: "numeric(20,8)", notNull: true },
    updated_at: { type: "timestamptz", notNull: true, default: pgm.func("now()") }
  });
  pgm.createIndex("league_rankings", ["risk_adjusted_score", "return_pct", "max_drawdown_pct"], {
    name: "league_rankings_order_idx",
    method: "btree"
  });
}

export async function down(pgm: MigrationBuilder): Promise<void> {
  pgm.dropTable("league_rankings");
  pgm.dropTable("league_equity_snapshots");
}
