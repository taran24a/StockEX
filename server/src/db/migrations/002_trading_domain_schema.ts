import type { MigrationBuilder } from "node-pg-migrate";

export async function up(pgm: MigrationBuilder): Promise<void> {
  pgm.addColumns("users", {
    avatar_url: { type: "text" }
  });

  pgm.createTable("accounts", {
    id: { type: "uuid", primaryKey: true, default: pgm.func("gen_random_uuid()") },
    user_id: { type: "uuid", notNull: true, unique: true, references: "users", onDelete: "CASCADE" },
    cash_balance: { type: "numeric(20,0)", notNull: true, default: "100000000", check: "cash_balance >= 0" },
    reserved_balance: { type: "numeric(20,0)", notNull: true, default: "0", check: "reserved_balance >= 0" },
    version: { type: "integer", notNull: true, default: 0, check: "version >= 0" },
    created_at: { type: "timestamptz", notNull: true, default: pgm.func("now()") },
    updated_at: { type: "timestamptz", notNull: true, default: pgm.func("now()") }
  });
  pgm.sql(`
    INSERT INTO accounts (user_id, cash_balance)
    SELECT users.id, COALESCE(wallets.balance_paise, 100000000)
    FROM users
    LEFT JOIN wallets ON wallets.user_id = users.id
    ON CONFLICT (user_id) DO NOTHING
  `);
  pgm.sql(`
    CREATE FUNCTION sync_legacy_wallet_to_account() RETURNS trigger AS $$
    BEGIN
      INSERT INTO accounts (user_id, cash_balance)
      VALUES (NEW.user_id, NEW.balance_paise)
      ON CONFLICT (user_id) DO UPDATE
      SET cash_balance = EXCLUDED.cash_balance,
          version = accounts.version + 1,
          updated_at = now();
      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql;

    CREATE TRIGGER wallets_sync_account
    AFTER INSERT OR UPDATE OF balance_paise ON wallets
    FOR EACH ROW EXECUTE FUNCTION sync_legacy_wallet_to_account();
  `);

  pgm.createTable("instruments", {
    id: { type: "uuid", primaryKey: true, default: pgm.func("gen_random_uuid()") },
    symbol: { type: "varchar(32)", notNull: true, unique: true },
    name: { type: "varchar(120)", notNull: true },
    sector: { type: "varchar(80)", notNull: true, default: "Unknown" },
    tick_size: { type: "numeric(20,0)", notNull: true, default: "1", check: "tick_size > 0" },
    last_price: { type: "numeric(20,0)", notNull: true, check: "last_price > 0" },
    created_at: { type: "timestamptz", notNull: true, default: pgm.func("now()") },
    updated_at: { type: "timestamptz", notNull: true, default: pgm.func("now()") }
  });
  pgm.sql(`
    INSERT INTO instruments (symbol, name, last_price)
    VALUES
      ('ALFA', 'Alfa Industries', 12500000),
      ('BRAVO', 'Bravo Energy', 8750000),
      ('CIRRUS', 'Cirrus Technologies', 21000000),
      ('DELTA', 'Delta Foods', 4250000),
      ('ECHO', 'Echo Mobility', 6800000)
    ON CONFLICT (symbol) DO NOTHING
  `);
  pgm.sql(`
    WITH known_symbols AS (
      SELECT symbol, price_paise AS last_price FROM orders
      UNION ALL
      SELECT symbol, average_cost_paise AS last_price FROM positions
    )
    INSERT INTO instruments (symbol, name, last_price)
    SELECT symbol, symbol, GREATEST(COALESCE(MAX(last_price), 1), 1)
    FROM known_symbols
    GROUP BY symbol
    ON CONFLICT (symbol) DO NOTHING
  `);

  pgm.addColumns("positions", {
    account_id: { type: "uuid", references: "accounts", onDelete: "CASCADE" },
    instrument_id: { type: "uuid", references: "instruments", onDelete: "RESTRICT" },
    avg_cost: { type: "numeric(20,0)", check: "avg_cost >= 0" }
  });
  pgm.sql(`
    UPDATE positions AS position
    SET account_id = account.id, instrument_id = instrument.id, avg_cost = position.average_cost_paise
    FROM accounts AS account, instruments AS instrument
    WHERE account.user_id = position.user_id AND instrument.symbol = position.symbol
  `);
  pgm.alterColumn("positions", "account_id", { notNull: true });
  pgm.alterColumn("positions", "instrument_id", { notNull: true });
  pgm.alterColumn("positions", "avg_cost", { notNull: true });
  pgm.addConstraint("positions", "positions_account_instrument_unique", {
    unique: ["account_id", "instrument_id"]
  });
  pgm.createIndex("positions", ["account_id", "instrument_id"], { name: "positions_account_instrument_idx" });
  pgm.sql(`
    CREATE FUNCTION sync_legacy_trading_identity() RETURNS trigger AS $$
    BEGIN
      IF NEW.account_id IS NULL THEN
        SELECT id INTO NEW.account_id FROM accounts WHERE user_id = NEW.user_id;
      END IF;
      IF NEW.instrument_id IS NULL THEN
        SELECT id INTO NEW.instrument_id FROM instruments WHERE symbol = NEW.symbol;
      END IF;
      IF TG_TABLE_NAME = 'positions' THEN
        NEW.avg_cost := NEW.average_cost_paise;
      END IF;
      IF NEW.account_id IS NULL OR NEW.instrument_id IS NULL THEN
        RAISE EXCEPTION 'Could not resolve account and instrument for legacy trading row'
          USING ERRCODE = 'foreign_key_violation';
      END IF;
      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql;

    CREATE TRIGGER positions_sync_trading_identity
    BEFORE INSERT OR UPDATE ON positions
    FOR EACH ROW EXECUTE FUNCTION sync_legacy_trading_identity();
  `);

  pgm.addColumns("orders", {
    account_id: { type: "uuid", references: "accounts", onDelete: "CASCADE" },
    instrument_id: { type: "uuid", references: "instruments", onDelete: "RESTRICT" },
    type: { type: "varchar(10)", notNull: true, default: "market", check: "type IN ('market', 'limit')" },
    limit_price: { type: "numeric(20,0)", check: "limit_price IS NULL OR limit_price > 0" },
    filled_quantity: { type: "numeric(20,0)", notNull: true, default: "0", check: "filled_quantity >= 0" },
    idempotency_key: { type: "varchar(128)" }
  });
  pgm.sql(`
    UPDATE orders AS order_row
    SET account_id = account.id, instrument_id = instrument.id, filled_quantity = order_row.quantity
    FROM accounts AS account, instruments AS instrument
    WHERE account.user_id = order_row.user_id AND instrument.symbol = order_row.symbol
  `);
  pgm.alterColumn("orders", "account_id", { notNull: true });
  pgm.alterColumn("orders", "instrument_id", { notNull: true });
  pgm.dropConstraint("orders", "orders_status_check");
  pgm.addConstraint("orders", "orders_status_check", {
    check: "status IN ('pending', 'open', 'partially_filled', 'filled', 'cancelled', 'rejected')"
  });
  pgm.addConstraint("orders", "orders_limit_price_required_for_limit", {
    check: "type <> 'limit' OR limit_price IS NOT NULL"
  });
  pgm.addConstraint("orders", "orders_filled_quantity_lte_quantity", {
    check: "filled_quantity <= quantity"
  });
  pgm.addConstraint("orders", "orders_account_idempotency_key_unique", {
    unique: ["account_id", "idempotency_key"]
  });
  pgm.createIndex("orders", ["account_id", { name: "created_at", sort: "DESC" }], {
    name: "orders_account_created_at_idx"
  });
  pgm.createIndex("orders", ["account_id", "status", { name: "created_at", sort: "DESC" }], {
    name: "orders_account_status_created_at_idx"
  });
  pgm.createIndex("orders", ["instrument_id", { name: "created_at", sort: "DESC" }], {
    name: "orders_instrument_created_at_idx"
  });
  pgm.sql(`
    CREATE FUNCTION sync_legacy_order_fill() RETURNS trigger AS $$
    BEGIN
      IF NEW.status = 'filled' AND NEW.filled_quantity = 0 THEN
        NEW.filled_quantity := NEW.quantity;
      END IF;
      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql;

    CREATE TRIGGER orders_sync_trading_identity
    BEFORE INSERT OR UPDATE ON orders
    FOR EACH ROW EXECUTE FUNCTION sync_legacy_trading_identity();

    CREATE TRIGGER orders_sync_fill_quantity
    BEFORE INSERT OR UPDATE OF quantity, status, filled_quantity ON orders
    FOR EACH ROW EXECUTE FUNCTION sync_legacy_order_fill();
  `);

  pgm.createTable("candles", {
    instrument_id: { type: "uuid", notNull: true, references: "instruments", onDelete: "CASCADE" },
    ts: { type: "timestamptz", notNull: true },
    open: { type: "numeric(20,0)", notNull: true, check: "open > 0" },
    high: { type: "numeric(20,0)", notNull: true, check: "high > 0" },
    low: { type: "numeric(20,0)", notNull: true, check: "low > 0" },
    close: { type: "numeric(20,0)", notNull: true, check: "close > 0" },
    volume: { type: "numeric(20,0)", notNull: true, default: "0", check: "volume >= 0" }
  });
  pgm.addConstraint("candles", "candles_ohlc_bounds", {
    check: "high >= low AND high >= open AND high >= close AND low <= open AND low <= close"
  });
  pgm.addConstraint("candles", "candles_instrument_ts_pk", {
    primaryKey: ["instrument_id", "ts"]
  });
  pgm.createIndex("candles", ["instrument_id", { name: "ts", sort: "DESC" }], {
    name: "candles_instrument_ts_desc_idx"
  });

  pgm.createTable("fills", {
    id: { type: "uuid", primaryKey: true, default: pgm.func("gen_random_uuid()") },
    order_id: { type: "uuid", notNull: true, references: "orders", onDelete: "CASCADE" },
    counter_order_id: { type: "uuid", references: "orders", onDelete: "SET NULL" },
    price: { type: "numeric(20,0)", notNull: true, check: "price > 0" },
    quantity: { type: "numeric(20,0)", notNull: true, check: "quantity > 0" },
    fee: { type: "numeric(20,0)", notNull: true, default: "0", check: "fee >= 0" },
    executed_at: { type: "timestamptz", notNull: true, default: pgm.func("now()") }
  });
  pgm.sql(`
    INSERT INTO fills (order_id, price, quantity, executed_at)
    SELECT order_id, price_paise, quantity, created_at
    FROM trades
  `);
  pgm.createIndex("fills", ["order_id", { name: "executed_at", sort: "DESC" }], {
    name: "fills_order_executed_at_idx"
  });
  pgm.createIndex("fills", ["counter_order_id"], { name: "fills_counter_order_idx" });

  pgm.createTable("ledger_entries", {
    id: { type: "uuid", primaryKey: true, default: pgm.func("gen_random_uuid()") },
    account_id: { type: "uuid", notNull: true, references: "accounts", onDelete: "CASCADE" },
    fill_id: { type: "uuid", references: "fills", onDelete: "SET NULL" },
    entry_type: {
      type: "varchar(24)",
      notNull: true,
      check: "entry_type IN ('deposit', 'withdrawal', 'reserve', 'release', 'trade_debit', 'trade_credit', 'fee')"
    },
    amount: { type: "numeric(20,0)", notNull: true, check: "amount <> 0" },
    balance_after: { type: "numeric(20,0)", notNull: true, check: "balance_after >= 0" },
    created_at: { type: "timestamptz", notNull: true, default: pgm.func("now()") }
  });
  pgm.createIndex("ledger_entries", ["account_id", { name: "created_at", sort: "DESC" }], {
    name: "ledger_entries_account_created_at_idx"
  });
  pgm.createIndex("ledger_entries", ["fill_id"], { name: "ledger_entries_fill_idx" });

  pgm.createTable("domain_events", {
    id: { type: "uuid", primaryKey: true, default: pgm.func("gen_random_uuid()") },
    aggregate_type: { type: "varchar(64)", notNull: true },
    aggregate_id: { type: "uuid", notNull: true },
    event_type: { type: "varchar(128)", notNull: true },
    sequence_number: { type: "bigint", notNull: true, check: "sequence_number > 0" },
    payload: { type: "jsonb", notNull: true },
    request_id: { type: "uuid" },
    created_at: { type: "timestamptz", notNull: true, default: pgm.func("now()") }
  });
  pgm.addConstraint("domain_events", "domain_events_replay_idx", {
    unique: ["aggregate_type", "aggregate_id", "sequence_number"]
  });
  pgm.createIndex("domain_events", ["request_id"], { name: "domain_events_request_id_idx" });

  pgm.createTable("idempotency_records", {
    id: { type: "uuid", primaryKey: true, default: pgm.func("gen_random_uuid()") },
    account_id: { type: "uuid", notNull: true, references: "accounts", onDelete: "CASCADE" },
    key: { type: "varchar(128)", notNull: true },
    request_hash: { type: "varchar(128)", notNull: true },
    response: { type: "jsonb", notNull: true },
    status_code: { type: "smallint", notNull: true, check: "status_code BETWEEN 100 AND 599" },
    created_at: { type: "timestamptz", notNull: true, default: pgm.func("now()") }
  });
  pgm.addConstraint("idempotency_records", "idempotency_records_account_key_unique", {
    unique: ["account_id", "key"]
  });

  pgm.createTable("risk_rules", {
    id: { type: "uuid", primaryKey: true, default: pgm.func("gen_random_uuid()") },
    account_id: { type: "uuid", notNull: true, unique: true, references: "accounts", onDelete: "CASCADE" },
    max_order_notional: { type: "numeric(20,0)", notNull: true, check: "max_order_notional > 0" },
    max_concentration_pct: {
      type: "numeric(5,2)",
      notNull: true,
      check: "max_concentration_pct > 0 AND max_concentration_pct <= 100"
    },
    created_at: { type: "timestamptz", notNull: true, default: pgm.func("now()") },
    updated_at: { type: "timestamptz", notNull: true, default: pgm.func("now()") }
  });

  pgm.createTable("risk_alerts", {
    id: { type: "uuid", primaryKey: true, default: pgm.func("gen_random_uuid()") },
    account_id: { type: "uuid", notNull: true, references: "accounts", onDelete: "CASCADE" },
    rule_id: { type: "uuid", references: "risk_rules", onDelete: "SET NULL" },
    order_id: { type: "uuid", references: "orders", onDelete: "SET NULL" },
    alert_type: { type: "varchar(64)", notNull: true },
    severity: { type: "varchar(16)", notNull: true, check: "severity IN ('info', 'warning', 'critical')" },
    message: { type: "text", notNull: true },
    details: { type: "jsonb", notNull: true, default: pgm.func("'{}'::jsonb") },
    acknowledged_at: { type: "timestamptz" },
    created_at: { type: "timestamptz", notNull: true, default: pgm.func("now()") }
  });
  pgm.createIndex("risk_alerts", ["account_id", { name: "created_at", sort: "DESC" }], {
    name: "risk_alerts_account_created_at_idx"
  });

  pgm.createTable("watchlists", {
    id: { type: "uuid", primaryKey: true, default: pgm.func("gen_random_uuid()") },
    account_id: { type: "uuid", notNull: true, references: "accounts", onDelete: "CASCADE" },
    name: { type: "varchar(80)", notNull: true },
    created_at: { type: "timestamptz", notNull: true, default: pgm.func("now()") },
    updated_at: { type: "timestamptz", notNull: true, default: pgm.func("now()") }
  });
  pgm.addConstraint("watchlists", "watchlists_account_name_unique", { unique: ["account_id", "name"] });
  pgm.createTable("watchlist_items", {
    watchlist_id: { type: "uuid", notNull: true, references: "watchlists", onDelete: "CASCADE" },
    instrument_id: { type: "uuid", notNull: true, references: "instruments", onDelete: "CASCADE" },
    created_at: { type: "timestamptz", notNull: true, default: pgm.func("now()") }
  });
  pgm.addConstraint("watchlist_items", "watchlist_items_watchlist_instrument_pk", {
    primaryKey: ["watchlist_id", "instrument_id"]
  });
}

export async function down(pgm: MigrationBuilder): Promise<void> {
  pgm.sql(`
    DROP TRIGGER orders_sync_fill_quantity ON orders;
    DROP TRIGGER orders_sync_trading_identity ON orders;
    DROP FUNCTION sync_legacy_order_fill();
    DROP FUNCTION sync_legacy_trading_identity();
    DROP TRIGGER positions_sync_trading_identity ON positions;
    DROP TRIGGER wallets_sync_account ON wallets;
    DROP FUNCTION sync_legacy_wallet_to_account();
  `);
  pgm.dropTable("watchlist_items");
  pgm.dropTable("watchlists");
  pgm.dropTable("risk_alerts");
  pgm.dropTable("risk_rules");
  pgm.dropTable("idempotency_records");
  pgm.dropTable("domain_events");
  pgm.dropTable("ledger_entries");
  pgm.dropTable("fills");
  pgm.dropTable("candles");
  pgm.dropConstraint("orders", "orders_status_check");
  pgm.addConstraint("orders", "orders_status_check", { check: "status = 'filled'" });
  pgm.dropIndex("orders", ["instrument_id", "created_at"], { name: "orders_instrument_created_at_idx" });
  pgm.dropIndex("orders", ["account_id", "status", "created_at"], { name: "orders_account_status_created_at_idx" });
  pgm.dropIndex("orders", ["account_id", "created_at"], { name: "orders_account_created_at_idx" });
  pgm.dropConstraint("orders", "orders_account_idempotency_key_unique");
  pgm.dropConstraint("orders", "orders_filled_quantity_lte_quantity");
  pgm.dropConstraint("orders", "orders_limit_price_required_for_limit");
  pgm.dropColumns("orders", [
    "account_id",
    "instrument_id",
    "type",
    "limit_price",
    "filled_quantity",
    "idempotency_key"
  ]);
  pgm.dropIndex("positions", ["account_id", "instrument_id"], { name: "positions_account_instrument_idx" });
  pgm.dropConstraint("positions", "positions_account_instrument_unique");
  pgm.dropColumns("positions", ["account_id", "instrument_id", "avg_cost"]);
  pgm.dropTable("instruments");
  pgm.dropTable("accounts");
  pgm.dropColumns("users", ["avatar_url"]);
}
