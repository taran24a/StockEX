import type { MigrationBuilder } from "node-pg-migrate";

export async function up(pgm: MigrationBuilder): Promise<void> {
  pgm.addColumns("accounts", {
    last_virtual_reset_at: { type: "timestamptz" }
  });
  pgm.createTable("system_settings", {
    key: { type: "varchar(100)", primaryKey: true },
    value: { type: "jsonb", notNull: true },
    updated_at: { type: "timestamptz", notNull: true, default: pgm.func("now()") }
  });
  pgm.sql(`
    INSERT INTO system_settings (key, value)
    VALUES ('virtual_account_reset_cooldown_hours', '24'::jsonb);
  `);
  pgm.dropConstraint("ledger_entries", "ledger_entries_entry_type_check");
  pgm.addConstraint("ledger_entries", "ledger_entries_entry_type_check", {
    check: "entry_type IN ('deposit', 'withdrawal', 'virtual_reset', 'reserve', 'release', 'trade_debit', 'trade_credit', 'fee')"
  });
  pgm.dropConstraint("ledger_entries", "ledger_entries_amount_check");
  pgm.addConstraint("ledger_entries", "ledger_entries_amount_check", {
    check: "amount <> 0 OR entry_type = 'virtual_reset'"
  });
}

export async function down(pgm: MigrationBuilder): Promise<void> {
  pgm.dropConstraint("ledger_entries", "ledger_entries_amount_check");
  pgm.addConstraint("ledger_entries", "ledger_entries_amount_check", {
    check: "amount <> 0"
  });
  pgm.dropConstraint("ledger_entries", "ledger_entries_entry_type_check");
  pgm.addConstraint("ledger_entries", "ledger_entries_entry_type_check", {
    check: "entry_type IN ('deposit', 'withdrawal', 'reserve', 'release', 'trade_debit', 'trade_credit', 'fee')"
  });
  pgm.dropTable("system_settings");
  pgm.dropColumns("accounts", ["last_virtual_reset_at"]);
}
