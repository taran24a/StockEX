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

function randomInteger(max: number): number {
  return Math.floor(Math.random() * (max + 1));
}

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

    const existingCandles = await client.query<{ has_candles: boolean }>(
      "SELECT EXISTS (SELECT 1 FROM candles) AS has_candles"
    );
    if (existingCandles.rows[0]?.has_candles !== true) {
      const seededInstruments = await client.query<{ id: string; symbol: string }>(
        "SELECT id, symbol FROM instruments"
      );
      const instrumentIds = new Map(seededInstruments.rows.map(({ id, symbol }) => [symbol, id]));
      const today = new Date();
      today.setUTCHours(0, 0, 0, 0);

      for (const instrument of marketInstruments) {
        const instrumentId = instrumentIds.get(instrument.symbol);
        if (instrumentId === undefined) {
          throw new Error(`Could not seed synthetic candles for ${instrument.symbol}`);
        }
        let previousClose: number = instrument.initialPricePaise;

        for (let daysAgo = 89; daysAgo >= 0; daysAgo -= 1) {
          const timestamp = new Date(today);
          timestamp.setUTCDate(today.getUTCDate() - daysAgo);
          const open = previousClose;
          const movementBps = randomInteger(400) - 200;
          const close = Math.max(1, open + Number(BigInt(open) * BigInt(movementBps) / 10_000n));
          const spread = Math.max(1, Math.floor(open / 200));
          const high = Math.max(open, close) + randomInteger(spread);
          const low = Math.max(1, Math.min(open, close) - randomInteger(spread));

          await client.query(
            `INSERT INTO candles (instrument_id, ts, open, high, low, close, volume)
             VALUES ($1, $2, $3, $4, $5, $6, $7)
             ON CONFLICT (instrument_id, ts) DO NOTHING`,
            [instrumentId, timestamp.toISOString(), open, high, low, close, randomInteger(1_000_000)]
          );
          previousClose = close;
        }
      }
      console.info("Seeded 90 days of synthetic daily price history for the practice charts");
    }

    const intradayInstruments = await client.query<{
      id: string;
      symbol: string;
      last_price: string | number;
    }>(
      `SELECT instrument.id, instrument.symbol, instrument.last_price
       FROM instruments AS instrument
       WHERE (
         SELECT COUNT(*)
         FROM candles
         WHERE instrument_id = instrument.id
           AND ts >= NOW() - INTERVAL '7 days'
           AND ts > date_trunc('day', ts)
       ) < 10000`
    );
    const candleBatch: Array<[string, string, number, number, number, number, number]> = [];
    const insertCandleBatch = async (): Promise<void> => {
      if (candleBatch.length === 0) {
        return;
      }
      const values: Array<string | number> = [];
      const tuples = candleBatch.map((candle, index) => {
        values.push(...candle);
        const firstParameter = index * 7 + 1;
        return `(${Array.from({ length: 7 }, (_unused, offset) => `$${firstParameter + offset}`).join(", ")})`;
      });
      await client.query(
        `INSERT INTO candles (instrument_id, ts, open, high, low, close, volume)
         VALUES ${tuples.join(", ")}
         ON CONFLICT (instrument_id, ts) DO NOTHING`,
        values
      );
      candleBatch.length = 0;
    };
    const intradayEnd = new Date();
    intradayEnd.setUTCSeconds(0, 0);
    const intradayStart = new Date(intradayEnd.getTime() - 7 * 24 * 60 * 60 * 1000);

    for (const instrument of intradayInstruments.rows) {
      const priorCandle = await client.query<{ close: string | number }>(
        `SELECT close
         FROM candles
         WHERE instrument_id = $1 AND ts < $2
         ORDER BY ts DESC
         LIMIT 1`,
        [instrument.id, intradayStart.toISOString()]
      );
      let previousClose = Number(priorCandle.rows[0]?.close ?? instrument.last_price);

      for (let minute = 0; minute <= 7 * 24 * 60; minute += 1) {
        const timestamp = new Date(intradayStart.getTime() + minute * 60_000);
        if (timestamp.getUTCHours() === 0 && timestamp.getUTCMinutes() === 0) {
          continue;
        }
        const open = previousClose;
        const movementBps = randomInteger(10) - 5;
        const close = Math.max(1, open + Number(BigInt(open) * BigInt(movementBps) / 10_000n));
        const spread = Math.max(1, Math.floor(open / 100_000));
        const high = Math.max(open, close) + randomInteger(spread);
        const low = Math.max(1, Math.min(open, close) - randomInteger(spread));
        candleBatch.push([
          instrument.id,
          timestamp.toISOString(),
          open,
          high,
          low,
          close,
          randomInteger(10_000)
        ]);
        previousClose = close;

        if (candleBatch.length >= 500) {
          await insertCandleBatch();
        }
      }
    }
    await insertCandleBatch();
    if (intradayInstruments.rows.length > 0) {
      console.info("Seeded 7 days of synthetic one-minute price history for intraday charts");
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
         SELECT $1, $2::text, 100000, $3, accounts.id, instruments.id, $3
         FROM accounts, instruments
          WHERE accounts.user_id = $1 AND instruments.symbol = $2::text
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
