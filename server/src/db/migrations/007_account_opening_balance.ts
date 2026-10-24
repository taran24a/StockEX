import type { MigrationBuilder } from "node-pg-migrate";

export async function up(pgm: MigrationBuilder): Promise<void> {
  pgm.addColumns("accounts", {
    opening_balance: {
      type: "numeric(20,0)",
      notNull: true,
      default: "0",
      check: "opening_balance >= 0"
    }
  });
  pgm.sql(`
    UPDATE accounts AS account
    SET opening_balance = account.cash_balance - COALESCE(ledger.cash_movements, 0)
    FROM (
      SELECT account_id,
             SUM(amount) FILTER (WHERE entry_type NOT IN ('reserve', 'release')) AS cash_movements
      FROM ledger_entries
      GROUP BY account_id
    ) AS ledger
    WHERE account.id = ledger.account_id;

    UPDATE accounts AS account
    SET opening_balance = account.cash_balance
    WHERE NOT EXISTS (
      SELECT 1 FROM ledger_entries AS entry WHERE entry.account_id = account.id
    );
  `);
}

export async function down(pgm: MigrationBuilder): Promise<void> {
  pgm.dropColumns("accounts", ["opening_balance"]);
}
