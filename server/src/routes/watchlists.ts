import { Router } from "express";
import {
  CreateWatchlistRequestSchema,
  WatchlistDetailSchema,
  WatchlistsResponseSchema,
  UpdateWatchlistRequestSchema
} from "@tradewise/shared";
import type { Pool } from "pg";
import { databaseInteger } from "../db/values.js";
import { validateBody, validateParams, validatedBody, validatedParams } from "../http-validation.js";
import { authenticate } from "../middleware/authenticate.js";
import { ConflictError, NotFoundError } from "../services/errors.js";
import { z } from "zod";

const WatchlistParamsSchema = z.object({ watchlistId: z.uuid() });
const WatchlistInstrumentParamsSchema = WatchlistParamsSchema.extend({
  symbol: z.string().regex(/^[A-Z][A-Z0-9.-]{0,31}$/)
});

interface WatchlistRow {
  id: string;
  account_id: string;
  name: string;
  created_at: Date;
  updated_at: Date;
}

interface WatchlistInstrumentRow {
  symbol: string;
  name: string;
  last_price: string | number;
}

function isUniqueViolation(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "23505";
}

export function createWatchlistsRouter(pool: Pool, secret: string): Router {
  const router = Router();
  const requireAuth = authenticate(secret);

  async function ownedWatchlist(userId: string, id: string): Promise<WatchlistRow> {
    const result = await pool.query<WatchlistRow>(
      `SELECT watchlists.id, watchlists.account_id, watchlists.name,
              watchlists.created_at, watchlists.updated_at
       FROM watchlists
       JOIN accounts ON accounts.id = watchlists.account_id
       WHERE watchlists.id = $1 AND accounts.user_id = $2`,
      [id, userId]
    );
    const row = result.rows[0];
    if (row === undefined) {
      throw new NotFoundError("Watchlist was not found");
    }
    return row;
  }

  async function details(row: WatchlistRow) {
    const instruments = await pool.query<WatchlistInstrumentRow>(
      `SELECT instruments.symbol, instruments.name, instruments.last_price
       FROM watchlist_items
       JOIN instruments ON instruments.id = watchlist_items.instrument_id
       WHERE watchlist_items.watchlist_id = $1 ORDER BY instruments.symbol`,
      [row.id]
    );
    return WatchlistDetailSchema.parse({
      id: row.id,
      name: row.name,
      createdAt: row.created_at.toISOString(),
      updatedAt: row.updated_at.toISOString(),
      instruments: instruments.rows.map((instrument) => ({
        symbol: instrument.symbol,
        name: instrument.name,
        pricePaise: databaseInteger(instrument.last_price, "watchlist instrument price")
      }))
    });
  }

  router.get("/", requireAuth, async (request, response) => {
    const result = await pool.query<WatchlistRow>(
      `SELECT watchlists.id, watchlists.account_id, watchlists.name,
              watchlists.created_at, watchlists.updated_at
       FROM watchlists
       JOIN accounts ON accounts.id = watchlists.account_id
       WHERE accounts.user_id = $1 ORDER BY watchlists.created_at, watchlists.id`,
      [request.auth?.id]
    );
    response.json(WatchlistsResponseSchema.parse({
      watchlists: await Promise.all(result.rows.map(details))
    }));
  });

  router.post("/", requireAuth, validateBody(CreateWatchlistRequestSchema), async (request, response) => {
    const { name } = validatedBody<z.infer<typeof CreateWatchlistRequestSchema>>(response);
    try {
      const result = await pool.query<WatchlistRow>(
        `INSERT INTO watchlists (account_id, name)
         SELECT id, $2 FROM accounts WHERE user_id = $1
         RETURNING id, account_id, name, created_at, updated_at`,
        [request.auth?.id, name]
      );
      const row = result.rows[0];
      if (row === undefined) {
        throw new NotFoundError("Trading account was not found");
      }
      response.status(201).json(await details(row));
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new ConflictError("A watchlist with this name already exists", "WATCHLIST_NAME_CONFLICT");
      }
      throw error;
    }
  });

  router.get("/:watchlistId", requireAuth, validateParams(WatchlistParamsSchema), async (request, response) => {
    const { watchlistId } = validatedParams<z.infer<typeof WatchlistParamsSchema>>(response);
    const row = await ownedWatchlist(request.auth!.id, watchlistId);
    response.json(await details(row));
  });

  router.patch(
    "/:watchlistId",
    requireAuth,
    validateParams(WatchlistParamsSchema),
    validateBody(UpdateWatchlistRequestSchema),
    async (request, response) => {
      const { watchlistId } = validatedParams<z.infer<typeof WatchlistParamsSchema>>(response);
      const { name } = validatedBody<z.infer<typeof UpdateWatchlistRequestSchema>>(response);
      await ownedWatchlist(request.auth!.id, watchlistId);
      try {
        const result = await pool.query<WatchlistRow>(
          `UPDATE watchlists SET name = $3, updated_at = now()
           FROM accounts
           WHERE watchlists.id = $1 AND accounts.id = watchlists.account_id AND accounts.user_id = $2
           RETURNING watchlists.id, watchlists.account_id, watchlists.name,
                     watchlists.created_at, watchlists.updated_at`,
          [watchlistId, request.auth!.id, name]
        );
        const row = result.rows[0];
        if (row === undefined) {
          throw new NotFoundError("Watchlist was not found");
        }
        response.json(await details(row));
      } catch (error) {
        if (isUniqueViolation(error)) {
          throw new ConflictError("A watchlist with this name already exists", "WATCHLIST_NAME_CONFLICT");
        }
        throw error;
      }
    }
  );

  router.delete("/:watchlistId", requireAuth, validateParams(WatchlistParamsSchema), async (request, response) => {
    const { watchlistId } = validatedParams<z.infer<typeof WatchlistParamsSchema>>(response);
    await ownedWatchlist(request.auth!.id, watchlistId);
    await pool.query(
      `DELETE FROM watchlists USING accounts
       WHERE watchlists.id = $1 AND accounts.id = watchlists.account_id AND accounts.user_id = $2`,
      [watchlistId, request.auth!.id]
    );
    response.status(204).end();
  });

  router.post(
    "/:watchlistId/instruments/:symbol",
    requireAuth,
    validateParams(WatchlistInstrumentParamsSchema),
    async (request, response) => {
      const { watchlistId, symbol } = validatedParams<z.infer<typeof WatchlistInstrumentParamsSchema>>(response);
      await ownedWatchlist(request.auth!.id, watchlistId);
      const result = await pool.query(
        `INSERT INTO watchlist_items (watchlist_id, instrument_id)
         SELECT $1, id FROM instruments WHERE symbol = $2
         ON CONFLICT (watchlist_id, instrument_id) DO NOTHING`,
        [watchlistId, symbol]
      );
      if (result.rowCount === 0) {
        const instrument = await pool.query("SELECT 1 FROM instruments WHERE symbol = $1", [symbol]);
        if (instrument.rowCount === 0) {
          throw new NotFoundError("Instrument was not found");
        }
      }
      response.json(await details(await ownedWatchlist(request.auth!.id, watchlistId)));
    }
  );

  router.delete(
    "/:watchlistId/instruments/:symbol",
    requireAuth,
    validateParams(WatchlistInstrumentParamsSchema),
    async (request, response) => {
      const { watchlistId, symbol } = validatedParams<z.infer<typeof WatchlistInstrumentParamsSchema>>(response);
      await ownedWatchlist(request.auth!.id, watchlistId);
      await pool.query(
        `DELETE FROM watchlist_items
         USING instruments
         WHERE watchlist_items.watchlist_id = $1
           AND watchlist_items.instrument_id = instruments.id
           AND instruments.symbol = $2`,
        [watchlistId, symbol]
      );
      response.status(204).end();
    }
  );

  return router;
}
