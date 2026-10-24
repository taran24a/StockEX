import bcrypt from "bcrypt";
import { randomUUID } from "node:crypto";
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
const marketMakerEmail = "liquidity-bot@tradewise.internal";

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

    const botPasswordHash = await bcrypt.hash(randomUUID(), 12);
    const botUser = await client.query<{ id: string }>(
      `INSERT INTO users (email, display_name, password_hash, role)
       VALUES ($1, 'TradeWise Liquidity Bot', $2, 'user')
       ON CONFLICT (email) DO UPDATE
       SET display_name = EXCLUDED.display_name, password_hash = EXCLUDED.password_hash
       RETURNING id`,
      [marketMakerEmail, botPasswordHash]
    );
    const botUserId = botUser.rows[0]?.id;
    if (botUserId === undefined) {
      throw new Error("Could not seed dedicated liquidity bot account");
    }
    await client.query(
      `INSERT INTO wallets (user_id, balance_paise) VALUES ($1, 1000000000000000)
       ON CONFLICT (user_id) DO UPDATE SET balance_paise = GREATEST(wallets.balance_paise, EXCLUDED.balance_paise)`,
      [botUserId]
    );
    await client.query(
      `INSERT INTO ledger_entries (account_id, entry_type, amount, balance_after)
       SELECT account.id, 'deposit', account.cash_balance, account.cash_balance
       FROM accounts AS account
       WHERE account.user_id = $1 AND account.opening_balance = 0
         AND NOT EXISTS (
           SELECT 1 FROM ledger_entries AS entry
           WHERE entry.account_id = account.id AND entry.entry_type = 'deposit'
         )`,
      [botUserId]
    );
    for (const instrument of marketInstruments) {
      await client.query(
        `INSERT INTO positions
           (user_id, symbol, quantity, average_cost_paise, account_id, instrument_id, avg_cost)
         SELECT $1, $2, 100000, $3, accounts.id, instruments.id, $3
         FROM accounts, instruments
         WHERE accounts.user_id = $1 AND instruments.symbol = $2
         ON CONFLICT (user_id, symbol) DO NOTHING`,
        [botUserId, instrument.symbol, instrument.initialPricePaise]
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
      await client.query(
        `INSERT INTO ledger_entries (account_id, entry_type, amount, balance_after)
         SELECT account.id, 'deposit', account.cash_balance, account.cash_balance
         FROM accounts AS account
         WHERE account.user_id = $1 AND account.opening_balance = 0
           AND NOT EXISTS (
             SELECT 1 FROM ledger_entries AS entry
             WHERE entry.account_id = account.id AND entry.entry_type = 'deposit'
           )`,
        [userId]
      );
    }
  });

  console.info("TradeWise admin and demo accounts are ready");
} finally {
  await pool.end();
}
