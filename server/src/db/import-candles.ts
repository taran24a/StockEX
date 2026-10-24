import { createReadStream } from "node:fs";
import { createInterface } from "node:readline";
import { resolve } from "node:path";
import { createDatabasePool } from "./pool.js";
import { loadEnvironment } from "../config/index.js";
import { logger } from "../logger.js";

const expectedHeader = "symbol,ts,open,high,low,close,volume";
const safeInteger = /^(0|[1-9]\d*)$/;
const isoTimestamp = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/;

function parseCsvRow(line: string): string[] {
  const fields: string[] = [];
  let field = "";
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const character = line[index];
    if (character === '"') {
      if (quoted && line[index + 1] === '"') {
        field += '"';
        index += 1;
      } else {
        quoted = !quoted;
      }
    } else if (character === "," && !quoted) {
      fields.push(field);
      field = "";
    } else {
      field += character;
    }
  }
  if (quoted) {
    throw new Error("CSV row contains an unclosed quoted field");
  }
  fields.push(field);
  return fields;
}

function parseInteger(value: string, field: string, allowZero = false): number {
  if (!safeInteger.test(value) || (!allowZero && value === "0")) {
    throw new Error(`${field} must be a ${allowZero ? "non-negative" : "positive"} integer`);
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) {
    throw new Error(`${field} exceeds the safe integer range`);
  }
  return parsed;
}

const environment = loadEnvironment();
const pool = createDatabasePool(environment);
const inputPath = resolve(process.argv[2] ?? "data/candles.csv");
const client = await pool.connect();
let transactionOpen = false;
let imported = 0;
let lineNumber = 0;

try {
  const instruments = await client.query<{ id: string; symbol: string }>("SELECT id, symbol FROM instruments");
  const instrumentIds = new Map(instruments.rows.map(({ id, symbol }) => [symbol, id]));
  await client.query("BEGIN");
  transactionOpen = true;

  // SYLLABUS: streams
  // SYLLABUS: fs/path
  const lines = createInterface({ input: createReadStream(inputPath), crlfDelay: Infinity });
  for await (const line of lines) {
    lineNumber += 1;
    if (lineNumber === 1) {
      if (line.trim() !== expectedHeader) {
        throw new Error(`Expected CSV header: ${expectedHeader}`);
      }
      continue;
    }
    if (line.trim().length === 0) {
      continue;
    }
    const [symbol, timestamp, openRaw, highRaw, lowRaw, closeRaw, volumeRaw, ...extra] = parseCsvRow(line);
    if (extra.length > 0 || symbol === undefined || timestamp === undefined ||
        openRaw === undefined || highRaw === undefined || lowRaw === undefined ||
        closeRaw === undefined || volumeRaw === undefined) {
      throw new Error(`Invalid column count on CSV line ${lineNumber}`);
    }
    const instrumentId = instrumentIds.get(symbol);
    if (instrumentId === undefined) {
      throw new Error(`Unknown instrument "${symbol}" on CSV line ${lineNumber}`);
    }
    if (!isoTimestamp.test(timestamp) || Number.isNaN(Date.parse(timestamp))) {
      throw new Error(`Invalid timestamp on CSV line ${lineNumber}`);
    }
    const open = parseInteger(openRaw, "open");
    const high = parseInteger(highRaw, "high");
    const low = parseInteger(lowRaw, "low");
    const close = parseInteger(closeRaw, "close");
    const volume = parseInteger(volumeRaw, "volume", true);
    if (high < Math.max(open, close, low) || low > Math.min(open, close)) {
      throw new Error(`Invalid OHLC bounds on CSV line ${lineNumber}`);
    }
    const inserted = await client.query(
      `INSERT INTO candles (instrument_id, ts, open, high, low, close, volume)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (instrument_id, ts) DO NOTHING`,
      [instrumentId, timestamp, open, high, low, close, volume]
    );
    imported += inserted.rowCount ?? 0;
  }
  if (lineNumber === 0) {
    throw new Error("Candle CSV is empty and has no header");
  }

  await client.query("COMMIT");
  transactionOpen = false;
  logger.info({ imported, inputPath }, "Candle CSV import completed");
} catch (error) {
  if (transactionOpen) {
    await client.query("ROLLBACK");
  }
  logger.error({ err: error, lineNumber, inputPath }, "Candle CSV import failed");
  throw error;
} finally {
  client.release();
  await pool.end();
}
