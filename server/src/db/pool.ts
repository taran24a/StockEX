import pg from "pg";
import type { Environment } from "../config/index.js";

const { Pool } = pg;

export function createDatabasePool(environment: Environment): pg.Pool {
  return new Pool({
    connectionString: environment.DATABASE_URL,
    max: 10,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000
  });
}
