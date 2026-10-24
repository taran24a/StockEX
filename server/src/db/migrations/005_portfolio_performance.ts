import type { MigrationBuilder } from "node-pg-migrate";

export async function up(pgm: MigrationBuilder): Promise<void> {
  pgm.addColumns("ledger_entries", {
    equity_after: { type: "numeric(20,0)", check: "equity_after IS NULL OR equity_after >= 0" },
    realized_pnl_paise: { type: "numeric(20,0)", notNull: true, default: "0" }
  });
}

export async function down(pgm: MigrationBuilder): Promise<void> {
  pgm.dropColumns("ledger_entries", ["equity_after", "realized_pnl_paise"]);
}
