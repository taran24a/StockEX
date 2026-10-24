import type { MigrationBuilder } from "node-pg-migrate";

export async function up(pgm: MigrationBuilder): Promise<void> {
  pgm.createTable("users", {
    id: { type: "uuid", primaryKey: true, default: pgm.func("gen_random_uuid()") },
    email: { type: "varchar(254)", notNull: true, unique: true },
    display_name: { type: "varchar(60)", notNull: true },
    password_hash: { type: "varchar(60)", notNull: true },
    avatar_object_key: { type: "varchar(100)" },
    role: { type: "varchar(10)", notNull: true, default: "user", check: "role IN ('user', 'admin')" },
    created_at: { type: "timestamptz", notNull: true, default: pgm.func("now()") }
  });

  pgm.createTable("wallets", {
    user_id: {
      type: "uuid",
      primaryKey: true,
      references: "users",
      onDelete: "CASCADE"
    },
    balance_paise: { type: "numeric(20,0)", notNull: true, default: "100000000", check: "balance_paise >= 0" },
    updated_at: { type: "timestamptz", notNull: true, default: pgm.func("now()") }
  });

  pgm.createTable("positions", {
    user_id: { type: "uuid", notNull: true, references: "users", onDelete: "CASCADE" },
    symbol: { type: "varchar(12)", notNull: true },
    quantity: { type: "numeric(20,0)", notNull: true, check: "quantity > 0" },
    average_cost_paise: { type: "numeric(20,0)", notNull: true, check: "average_cost_paise >= 0" }
  });
  pgm.addConstraint("positions", "positions_user_symbol_pk", {
    primaryKey: ["user_id", "symbol"]
  });

  pgm.createTable("orders", {
    id: { type: "uuid", primaryKey: true, default: pgm.func("gen_random_uuid()") },
    user_id: { type: "uuid", notNull: true, references: "users", onDelete: "CASCADE" },
    symbol: { type: "varchar(12)", notNull: true },
    side: { type: "varchar(4)", notNull: true, check: "side IN ('buy', 'sell')" },
    quantity: { type: "numeric(20,0)", notNull: true, check: "quantity > 0" },
    price_paise: { type: "numeric(20,0)", notNull: true, check: "price_paise > 0" },
    total_paise: { type: "numeric(20,0)", notNull: true, check: "total_paise > 0" },
    status: { type: "varchar(10)", notNull: true, default: "filled", check: "status = 'filled'" },
    created_at: { type: "timestamptz", notNull: true, default: pgm.func("now()") }
  });
  pgm.createIndex("orders", ["user_id", { name: "created_at", sort: "DESC" }]);

  pgm.createTable("trades", {
    id: { type: "uuid", primaryKey: true, default: pgm.func("gen_random_uuid()") },
    order_id: { type: "uuid", notNull: true, unique: true, references: "orders", onDelete: "CASCADE" },
    user_id: { type: "uuid", notNull: true, references: "users", onDelete: "CASCADE" },
    symbol: { type: "varchar(12)", notNull: true },
    side: { type: "varchar(4)", notNull: true, check: "side IN ('buy', 'sell')" },
    quantity: { type: "numeric(20,0)", notNull: true, check: "quantity > 0" },
    price_paise: { type: "numeric(20,0)", notNull: true, check: "price_paise > 0" },
    total_paise: { type: "numeric(20,0)", notNull: true, check: "total_paise > 0" },
    created_at: { type: "timestamptz", notNull: true, default: pgm.func("now()") }
  });
  pgm.createIndex("trades", ["user_id", { name: "created_at", sort: "DESC" }]);
}

export async function down(pgm: MigrationBuilder): Promise<void> {
  pgm.dropTable("trades");
  pgm.dropTable("orders");
  pgm.dropTable("positions");
  pgm.dropTable("wallets");
  pgm.dropTable("users");
}
