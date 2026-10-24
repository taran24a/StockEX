import type { MigrationBuilder } from "node-pg-migrate";

export async function up(pgm: MigrationBuilder): Promise<void> {
  pgm.addColumns("risk_rules", {
    max_sector_concentration_pct: {
      type: "numeric(5,2)",
      notNull: true,
      default: "45.00",
      check: "max_sector_concentration_pct > 0 AND max_sector_concentration_pct <= 100"
    }
  });
}

export async function down(pgm: MigrationBuilder): Promise<void> {
  pgm.dropColumns("risk_rules", ["max_sector_concentration_pct"]);
}
