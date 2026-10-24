import type { Pool, PoolClient } from "pg";
import { logger } from "../logger.js";

export async function withTransaction<T>(
  pool: Pool,
  operation: (client: PoolClient) => Promise<T>
): Promise<T> {
  const client = await pool.connect();

  try {
    await client.query("BEGIN");
    const result = await operation(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    try {
      await client.query("ROLLBACK");
    } catch (rollbackError) {
      logger.error({ err: rollbackError }, "Database transaction rollback failed");
    }
    throw error;
  } finally {
    client.release();
  }
}
