import type { MigrationBuilder } from "node-pg-migrate";

export async function up(pgm: MigrationBuilder): Promise<void> {
  pgm.addColumns("fills", {
    execution_sequence: {
      type: "bigserial",
      notNull: true,
      unique: true
    }
  });
}

export async function down(pgm: MigrationBuilder): Promise<void> {
  pgm.dropColumns("fills", ["execution_sequence"]);
}
