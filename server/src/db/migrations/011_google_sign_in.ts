import type { MigrationBuilder } from "node-pg-migrate";

export async function up(pgm: MigrationBuilder): Promise<void> {
  pgm.addColumn("users", {
    google_sub: { type: "varchar(255)", unique: true }
  });
  pgm.alterColumn("users", "password_hash", { notNull: false });
}

export async function down(pgm: MigrationBuilder): Promise<void> {
  pgm.dropColumn("users", "google_sub");
}
