import bcrypt from "bcrypt";
import { createDatabasePool } from "./pool.js";
import { withTransaction } from "./transaction.js";
import { loadEnvironment } from "../config/index.js";
import { marketInstruments } from "../feed/market.js";

const environment = loadEnvironment();
const pool = createDatabasePool(environment);
const seedUsers = [
  { email: "demo@tradewise.dev", displayName: "TradeWise Demo", password: "Demo@1234", role: "user" },
  { email: "admin@tradewise.dev", displayName: "TradeWise Admin", password: "Admin@1234", role: "admin" }
] as const;

try {
  await withTransaction(pool, async (client) => {
    for (const instrument of marketInstruments) {
      await client.query(
        `INSERT INTO instruments (symbol, name, sector, tick_size, last_price)
         VALUES ($1, $2, $3, 1, $4)
         ON CONFLICT (symbol) DO UPDATE
         SET name = EXCLUDED.name, sector = EXCLUDED.sector, tick_size = EXCLUDED.tick_size`,
        [instrument.symbol, instrument.name, instrument.sector, instrument.initialPricePaise]
      );
    }

    for (const seedUser of seedUsers) {
      const passwordHash = await bcrypt.hash(seedUser.password, 12);
      const inserted = await client.query<{ id: string }>(
        `INSERT INTO users (email, display_name, password_hash, role)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (email) DO UPDATE
         SET display_name = EXCLUDED.display_name,
             password_hash = EXCLUDED.password_hash,
             role = EXCLUDED.role
         RETURNING id`,
        [seedUser.email, seedUser.displayName, passwordHash, seedUser.role]
      );
      const userId = inserted.rows[0]?.id;
      if (userId === undefined) {
        throw new Error(`Could not seed user ${seedUser.email}`);
      }
      await client.query(
        "INSERT INTO wallets (user_id, balance_paise) VALUES ($1, $2) ON CONFLICT (user_id) DO NOTHING",
        [userId, 100_000_000]
      );
    }
  });

  console.info("TradeWise admin and demo accounts are ready");
} finally {
  await pool.end();
}
