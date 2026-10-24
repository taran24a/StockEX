import type { MigrationBuilder } from "node-pg-migrate";

export async function up(pgm: MigrationBuilder): Promise<void> {
  pgm.addColumns("orders", {
    reserved_amount: {
      type: "numeric(20,0)",
      notNull: true,
      default: "0",
      check: "reserved_amount >= 0"
    },
    cancel_reason: { type: "text" }
  });
}

export async function down(pgm: MigrationBuilder): Promise<void> {
  pgm.dropColumns("orders", ["reserved_amount"]);
}
