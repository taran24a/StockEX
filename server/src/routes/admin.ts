import { Readable } from "node:stream";
import { createInterface } from "node:readline";
import { Router } from "express";
import multer from "multer";
import {
  AdminAuditQuerySchema,
  AdminAuditResponseSchema,
  AdminInstrumentImportResponseSchema,
  AdminInstrumentImportRowSchema,
  AdminRoleUpdateSchema,
  AdminStatsResponseSchema,
  AdminUserSchema,
  AdminUsersResponseSchema,
  VirtualResetCooldownResponseSchema,
  VirtualResetCooldownSchema,
  TradeQuerySchema
} from "@tradewise/shared";
import type { AdminAuditQuery, AdminInstrumentImportRow, TradeQuery, VirtualResetCooldown } from "@tradewise/shared";
import type { Pool } from "pg";
import { z } from "zod";
import { withTransaction } from "../db/transaction.js";
import { databaseInteger } from "../db/values.js";
import { validateBody, validateParams, validateQuery, validatedBody, validatedParams, validatedQuery } from "../http-validation.js";
import { authenticate, requireRole } from "../middleware/authenticate.js";
import { ApiError, BadRequestError, NotFoundError } from "../services/errors.js";

interface AdminUserRow {
  id: string;
  email: string;
  display_name: string;
  role: "user" | "admin";
  created_at: Date;
}

interface AuditEventRow {
  id: string;
  aggregate_type: string;
  aggregate_id: string;
  event_type: string;
  sequence_number: string | number;
  payload: Record<string, unknown>;
  request_id: string | null;
  created_at: Date;
}

const UserIdParamsSchema = z.object({ id: z.uuid() });
const csvHeader = "symbol,name,sector,tick_size,last_price";
const csvContentTypes = new Set(["text/csv", "application/csv", "application/vnd.ms-excel"]);
const virtualResetCooldownSettingKey = "virtual_account_reset_cooldown_hours";

const csvUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024, files: 1 },
  fileFilter: (_request, file, callback) => {
    if (!csvContentTypes.has(file.mimetype)) {
      callback(new ApiError(415, "UNSUPPORTED_FILE_TYPE", "Instrument import must be a CSV file"));
      return;
    }
    callback(null, true);
  }
});

function parseCsvRow(line: string): string[] {
  const fields: string[] = [];
  let value = "";
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const character = line[index];
    if (character === '"') {
      if (quoted && line[index + 1] === '"') {
        value += '"';
        index += 1;
      } else {
        quoted = !quoted;
      }
    } else if (character === "," && !quoted) {
      fields.push(value);
      value = "";
    } else {
      value += character;
    }
  }
  if (quoted) {
    throw new BadRequestError("Instrument CSV contains an unclosed quoted field", "INVALID_CSV");
  }
  fields.push(value);
  return fields;
}

function parseInstrumentRow(fields: string[], lineNumber: number): AdminInstrumentImportRow {
  if (fields.length !== 5) {
    throw new BadRequestError(`Instrument CSV line ${lineNumber} must contain exactly five columns`, "INVALID_CSV");
  }
  const [symbol, name, sector, tickSizePaise, lastPricePaise] = fields;
  const parsed = AdminInstrumentImportRowSchema.safeParse({
    symbol,
    name,
    sector,
    tickSizePaise,
    lastPricePaise
  });
  if (!parsed.success) {
    throw new BadRequestError(
      `Invalid instrument on CSV line ${lineNumber}: ${parsed.error.issues.map((issue) => issue.message).join("; ")}`,
      "INVALID_CSV"
    );
  }
  return parsed.data;
}

async function importInstruments(pool: Pool, buffer: Buffer): Promise<number> {
  return withTransaction(pool, async (client) => {
    const lines = createInterface({ input: Readable.from([buffer]), crlfDelay: Infinity });
    let lineNumber = 0;
    let imported = 0;
    for await (const line of lines) {
      lineNumber += 1;
      if (lineNumber === 1) {
        if (line.trim() !== csvHeader) {
          throw new BadRequestError(`Expected instrument CSV header: ${csvHeader}`, "INVALID_CSV");
        }
        continue;
      }
      if (line.trim().length === 0) {
        continue;
      }
      const row = parseInstrumentRow(parseCsvRow(line), lineNumber);
      await client.query(
        `INSERT INTO instruments (symbol, name, sector, tick_size, last_price)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (symbol) DO UPDATE
         SET name = EXCLUDED.name,
             sector = EXCLUDED.sector,
             tick_size = EXCLUDED.tick_size,
             last_price = EXCLUDED.last_price,
             updated_at = now()`,
        [row.symbol, row.name, row.sector, row.tickSizePaise, row.lastPricePaise]
      );
      imported += 1;
    }
    if (lineNumber === 0) {
      throw new BadRequestError("Instrument CSV is empty", "INVALID_CSV");
    }
    return imported;
  });
}

export function createAdminRouter(pool: Pool, secret: string): Router {
  const router = Router();
  const requireAdmin = [authenticate(secret), requireRole("admin")];

  router.get("/settings/virtual-account-reset-cooldown", ...requireAdmin, async (_request, response) => {
    const result = await pool.query<{ value: number | string; updated_at: Date }>(
      "SELECT value, updated_at FROM system_settings WHERE key = $1",
      [virtualResetCooldownSettingKey]
    );
    const setting = result.rows[0];
    if (setting === undefined) {
      throw new Error("Virtual account reset cooldown setting is missing");
    }
    response.json(VirtualResetCooldownResponseSchema.parse({
      cooldownHours: Number(setting.value),
      updatedAt: setting.updated_at.toISOString()
    }));
  });

  router.put(
    "/settings/virtual-account-reset-cooldown",
    ...requireAdmin,
    validateBody(VirtualResetCooldownSchema),
    async (_request, response) => {
      const { cooldownHours } = validatedBody<VirtualResetCooldown>(response);
      const result = await pool.query<{ value: number | string; updated_at: Date }>(
        `INSERT INTO system_settings (key, value, updated_at)
         VALUES ($1, to_jsonb($2::integer), now())
         ON CONFLICT (key) DO UPDATE
         SET value = EXCLUDED.value, updated_at = now()
         RETURNING value, updated_at`,
        [virtualResetCooldownSettingKey, cooldownHours]
      );
      const setting = result.rows[0];
      if (setting === undefined) {
        throw new Error("Updated virtual account reset cooldown was not returned");
      }
      response.json(VirtualResetCooldownResponseSchema.parse({
        cooldownHours: Number(setting.value),
        updatedAt: setting.updated_at.toISOString()
      }));
    }
  );

  router.post("/instruments/import", ...requireAdmin, csvUpload.single("file"), async (request, response) => {
    const file = request.file;
    if (file === undefined) {
      throw new BadRequestError("Choose an instrument CSV file to import", "CSV_REQUIRED");
    }
    if (!file.originalname.toLowerCase().endsWith(".csv")) {
      throw new ApiError(415, "UNSUPPORTED_FILE_TYPE", "Instrument import must use a .csv file");
    }
    const imported = await importInstruments(pool, file.buffer);
    response.json(AdminInstrumentImportResponseSchema.parse({ imported }));
  });

  router.get("/users", ...requireAdmin, validateQuery(TradeQuerySchema), async (_request, response) => {
    const { limit, offset } = validatedQuery<TradeQuery>(response);
    const [usersResult, countResult] = await Promise.all([
      pool.query<AdminUserRow>(
        `SELECT id, email, display_name, role, created_at
         FROM users
         ORDER BY created_at DESC, id DESC
         LIMIT $1 OFFSET $2`,
        [limit, offset]
      ),
      pool.query<{ total: string | number }>("SELECT COUNT(*)::bigint AS total FROM users")
    ]);
    const users = usersResult.rows.map((row) => AdminUserSchema.parse({
      id: row.id,
      email: row.email,
      displayName: row.display_name,
      role: row.role,
      createdAt: row.created_at.toISOString()
    }));
    response.json(AdminUsersResponseSchema.parse({
      users,
      pagination: {
        limit,
        offset,
        total: databaseInteger(countResult.rows[0]?.total ?? 0, "user count")
      }
    }));
  });

  router.patch(
    "/users/:id/role",
    ...requireAdmin,
    validateParams(UserIdParamsSchema),
    validateBody(AdminRoleUpdateSchema),
    async (_request, response) => {
      const { id } = validatedParams<{ id: string }>(response);
      const { role } = validatedBody<{ role: "user" | "admin" }>(response);
      const result = await pool.query<AdminUserRow>(
        `UPDATE users
         SET role = $1
         WHERE id = $2
         RETURNING id, email, display_name, role, created_at`,
        [role, id]
      );
      const user = result.rows[0];
      if (user === undefined) {
        throw new NotFoundError("User was not found");
      }
      response.json(AdminUserSchema.parse({
        id: user.id,
        email: user.email,
        displayName: user.display_name,
        role: user.role,
        createdAt: user.created_at.toISOString()
      }));
    }
  );

  router.get("/audit", ...requireAdmin, validateQuery(AdminAuditQuerySchema), async (_request, response) => {
    const query = validatedQuery<AdminAuditQuery>(response);
    const conditions: string[] = [];
    const values: unknown[] = [];
    const filters = [
      ["aggregate_type", query.aggregateType],
      ["aggregate_id", query.aggregateId],
      ["event_type", query.eventType],
      ["request_id", query.requestId]
    ] as const;
    for (const [column, value] of filters) {
      if (value !== undefined) {
        values.push(value);
        conditions.push(`${column} = $${values.length}`);
      }
    }
    const where = conditions.length === 0 ? "" : `WHERE ${conditions.join(" AND ")}`;
    const [eventsResult, countResult] = await Promise.all([
      pool.query<AuditEventRow>(
        `SELECT id, aggregate_type, aggregate_id, event_type, sequence_number, payload, request_id, created_at
         FROM domain_events
         ${where}
         ORDER BY created_at DESC, id DESC
         LIMIT $${values.length + 1} OFFSET $${values.length + 2}`,
        [...values, query.limit, query.offset]
      ),
      pool.query<{ total: string | number }>(
        `SELECT COUNT(*)::bigint AS total FROM domain_events ${where}`,
        values
      )
    ]);
    response.json(AdminAuditResponseSchema.parse({
      events: eventsResult.rows.map((event) => ({
        id: event.id,
        aggregateType: event.aggregate_type,
        aggregateId: event.aggregate_id,
        eventType: event.event_type,
        sequenceNumber: databaseInteger(event.sequence_number, "event sequence number"),
        payload: event.payload,
        requestId: event.request_id,
        createdAt: event.created_at.toISOString()
      })),
      pagination: {
        limit: query.limit,
        offset: query.offset,
        total: databaseInteger(countResult.rows[0]?.total ?? 0, "audit event count")
      }
    }));
  });

  router.get("/stats", ...requireAdmin, async (_request, response) => {
    const result = await pool.query<{
      users: string | number;
      orders: string | number;
      volume_paise: string | number;
      rejected_order_pct: string | number;
    }>(
      `SELECT
         (SELECT COUNT(*) FROM users) AS users,
         COUNT(*) AS orders,
         COALESCE((SELECT SUM(fill.price * fill.quantity) FROM fills AS fill), 0) AS volume_paise,
         CASE WHEN COUNT(*) = 0 THEN 0
              ELSE 100.0 * COUNT(*) FILTER (WHERE order_row.status = 'rejected') / COUNT(*)
         END AS rejected_order_pct
       FROM orders AS order_row`
    );
    const stats = result.rows[0];
    if (stats === undefined) {
      throw new Error("Admin statistics query returned no row");
    }
    response.json(AdminStatsResponseSchema.parse({
      users: databaseInteger(stats.users, "user count"),
      orders: databaseInteger(stats.orders, "order count"),
      volumePaise: databaseInteger(stats.volume_paise, "trade volume"),
      rejectedOrderPct: Number(stats.rejected_order_pct)
    }));
  });

  return router;
}
