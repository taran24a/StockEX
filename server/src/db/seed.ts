import bcrypt from "bcrypt";
import { RegisterRequestSchema } from "@tradewise/shared";
import { createDatabasePool } from "./pool.js";
import { withTransaction } from "./transaction.js";
import { loadEnvironment } from "../config.js";

const environment = loadEnvironment();
const input = RegisterRequestSchema.safeParse({
  email: process.env.SEED_EMAIL,
  displayName: process.env.SEED_DISPLAY_NAME,
  password: process.env.SEED_PASSWORD
});

if (!input.success) {
  throw new Error("Set valid SEED_EMAIL, SEED_DISPLAY_NAME, and SEED_PASSWORD values before running the seed script");
}

const pool = createDatabasePool(environment);

try {
  const passwordHash = await bcrypt.hash(input.data.password, 12);
  const accountState = await withTransaction(pool, async (client) => {
    const inserted = await client.query<{ id: string }>(
      `INSERT INTO users (email, display_name, password_hash)
       VALUES ($1, $2, $3)
       ON CONFLICT (email) DO NOTHING
       RETURNING id`,
      [input.data.email.toLowerCase(), input.data.displayName, passwordHash]
    );
    let userId = inserted.rows[0]?.id;
    const wasCreated = userId !== undefined;

    if (userId === undefined) {
      const existing = await client.query<{ id: string }>("SELECT id FROM users WHERE email = $1", [
        input.data.email.toLowerCase()
      ]);
      userId = existing.rows[0]?.id;
      if (userId === undefined) {
        throw new Error("The seed account could not be created or found");
      }
    }

    await client.query("INSERT INTO wallets (user_id) VALUES ($1) ON CONFLICT (user_id) DO NOTHING", [userId]);
    return wasCreated;
  });

  console.info(
    accountState ? "Seed account created" : "Seed account already exists; existing credentials were preserved"
  );
} finally {
  await pool.end();
}
