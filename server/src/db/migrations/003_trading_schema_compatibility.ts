import type { MigrationBuilder } from "node-pg-migrate";

export async function up(pgm: MigrationBuilder): Promise<void> {
  pgm.sql(`
    DROP TRIGGER IF EXISTS orders_sync_fill_quantity ON orders;
    DROP TRIGGER IF EXISTS orders_sync_z_fill_quantity ON orders;
  `);
  pgm.alterColumn("orders", "user_id", { notNull: false });
  pgm.alterColumn("orders", "symbol", { notNull: false });
  pgm.alterColumn("orders", "price_paise", { notNull: false });
  pgm.alterColumn("orders", "total_paise", { notNull: false });
  pgm.alterColumn("orders", "status", { type: "varchar(20)" });
  pgm.dropIndex("positions", ["account_id", "instrument_id"], { name: "positions_account_instrument_idx" });

  pgm.sql(`
    CREATE OR REPLACE FUNCTION sync_legacy_trading_identity() RETURNS trigger AS $$
    BEGIN
      IF TG_TABLE_NAME = 'positions' THEN
        IF NEW.account_id IS NULL THEN
          SELECT id INTO NEW.account_id FROM accounts WHERE user_id = NEW.user_id;
        ELSIF TG_OP = 'UPDATE' AND NEW.user_id IS DISTINCT FROM OLD.user_id THEN
          SELECT id INTO NEW.account_id FROM accounts WHERE user_id = NEW.user_id;
        ELSIF NEW.user_id IS NULL THEN
          SELECT user_id INTO NEW.user_id FROM accounts WHERE id = NEW.account_id;
        ELSIF TG_OP = 'UPDATE' AND NEW.account_id IS DISTINCT FROM OLD.account_id THEN
          SELECT user_id INTO NEW.user_id FROM accounts WHERE id = NEW.account_id;
        END IF;
        IF NEW.instrument_id IS NULL THEN
          SELECT id INTO NEW.instrument_id FROM instruments WHERE symbol = NEW.symbol;
        ELSIF TG_OP = 'UPDATE' AND NEW.symbol IS DISTINCT FROM OLD.symbol THEN
          SELECT id INTO NEW.instrument_id FROM instruments WHERE symbol = NEW.symbol;
        ELSIF NEW.symbol IS NULL THEN
          SELECT symbol INTO NEW.symbol FROM instruments WHERE id = NEW.instrument_id;
        ELSIF TG_OP = 'UPDATE' AND NEW.instrument_id IS DISTINCT FROM OLD.instrument_id THEN
          SELECT symbol INTO NEW.symbol FROM instruments WHERE id = NEW.instrument_id;
        END IF;
        IF TG_OP = 'UPDATE' THEN
          IF NEW.avg_cost IS DISTINCT FROM OLD.avg_cost THEN
            NEW.average_cost_paise := NEW.avg_cost;
          ELSIF NEW.average_cost_paise IS DISTINCT FROM OLD.average_cost_paise THEN
            NEW.avg_cost := NEW.average_cost_paise;
          ELSE
            NEW.avg_cost := COALESCE(NEW.avg_cost, NEW.average_cost_paise);
            NEW.average_cost_paise := COALESCE(NEW.average_cost_paise, NEW.avg_cost);
          END IF;
        ELSE
          NEW.avg_cost := COALESCE(NEW.avg_cost, NEW.average_cost_paise);
          NEW.average_cost_paise := COALESCE(NEW.average_cost_paise, NEW.avg_cost);
        END IF;
      ELSE
        IF NEW.account_id IS NULL THEN
          SELECT id INTO NEW.account_id FROM accounts WHERE user_id = NEW.user_id;
        ELSIF TG_OP = 'UPDATE' AND NEW.user_id IS DISTINCT FROM OLD.user_id THEN
          SELECT id INTO NEW.account_id FROM accounts WHERE user_id = NEW.user_id;
        ELSIF NEW.user_id IS NULL THEN
          SELECT user_id INTO NEW.user_id FROM accounts WHERE id = NEW.account_id;
        ELSIF TG_OP = 'UPDATE' AND NEW.account_id IS DISTINCT FROM OLD.account_id THEN
          SELECT user_id INTO NEW.user_id FROM accounts WHERE id = NEW.account_id;
        END IF;
        IF NEW.instrument_id IS NULL THEN
          SELECT id INTO NEW.instrument_id FROM instruments WHERE symbol = NEW.symbol;
        ELSIF TG_OP = 'UPDATE' AND NEW.symbol IS DISTINCT FROM OLD.symbol THEN
          SELECT id INTO NEW.instrument_id FROM instruments WHERE symbol = NEW.symbol;
        ELSIF NEW.symbol IS NULL THEN
          SELECT symbol INTO NEW.symbol FROM instruments WHERE id = NEW.instrument_id;
        ELSIF TG_OP = 'UPDATE' AND NEW.instrument_id IS DISTINCT FROM OLD.instrument_id THEN
          SELECT symbol INTO NEW.symbol FROM instruments WHERE id = NEW.instrument_id;
        END IF;
      END IF;
      IF NEW.account_id IS NULL OR NEW.instrument_id IS NULL OR NEW.user_id IS NULL OR NEW.symbol IS NULL THEN
        RAISE EXCEPTION 'Could not resolve account, user, instrument, and symbol for trading row'
          USING ERRCODE = 'foreign_key_violation';
      END IF;
      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql;

    CREATE OR REPLACE FUNCTION sync_legacy_order_fill() RETURNS trigger AS $$
    BEGIN
      IF NEW.price_paise IS NULL THEN
        SELECT COALESCE(NEW.limit_price, last_price)
        INTO NEW.price_paise
        FROM instruments
        WHERE id = NEW.instrument_id;
      END IF;
      IF NEW.total_paise IS NULL AND NEW.price_paise IS NOT NULL THEN
        NEW.total_paise := NEW.price_paise * NEW.quantity;
      END IF;
      IF NEW.status = 'filled' AND NEW.filled_quantity = 0 THEN
        NEW.filled_quantity := NEW.quantity;
      END IF;
      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql;

    CREATE TRIGGER orders_sync_z_fill_quantity
    BEFORE INSERT OR UPDATE OF quantity, status, filled_quantity ON orders
    FOR EACH ROW EXECUTE FUNCTION sync_legacy_order_fill();
  `);
}

export async function down(pgm: MigrationBuilder): Promise<void> {
  pgm.sql(`
    DO $$
    BEGIN
      IF EXISTS (
        SELECT 1 FROM orders
        WHERE status <> 'filled'
          OR user_id IS NULL
          OR symbol IS NULL
          OR price_paise IS NULL
          OR total_paise IS NULL
      ) THEN
        RAISE EXCEPTION 'Cannot roll back schema compatibility while orders contain non-legacy data';
      END IF;
    END;
    $$;

    DROP TRIGGER IF EXISTS orders_sync_z_fill_quantity ON orders;
    DROP TRIGGER IF EXISTS orders_sync_fill_quantity ON orders;

    CREATE OR REPLACE FUNCTION sync_legacy_order_fill() RETURNS trigger AS $$
    BEGIN
      IF NEW.status = 'filled' AND NEW.filled_quantity = 0 THEN
        NEW.filled_quantity := NEW.quantity;
      END IF;
      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql;

    CREATE OR REPLACE FUNCTION sync_legacy_trading_identity() RETURNS trigger AS $$
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
  `);

  pgm.alterColumn("orders", "status", { type: "varchar(10)" });
  pgm.alterColumn("orders", "user_id", { notNull: true });
  pgm.alterColumn("orders", "symbol", { notNull: true });
  pgm.alterColumn("orders", "price_paise", { notNull: true });
  pgm.alterColumn("orders", "total_paise", { notNull: true });
  pgm.createIndex("positions", ["account_id", "instrument_id"], { name: "positions_account_instrument_idx" });
  pgm.sql(`
    CREATE TRIGGER orders_sync_fill_quantity
    BEFORE INSERT OR UPDATE OF quantity, status, filled_quantity ON orders
    FOR EACH ROW EXECUTE FUNCTION sync_legacy_order_fill();
  `);
}
