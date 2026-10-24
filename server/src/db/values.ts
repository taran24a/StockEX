import { ApiError } from "../errors.js";

export function databaseInteger(value: string | number, field: string): number {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isSafeInteger(parsed)) {
    throw new ApiError(500, "INVALID_DATABASE_VALUE", `Stored ${field} is outside the supported integer range`);
  }
  return parsed;
}

export function safeProduct(left: number, right: number, field: string): number {
  const result = BigInt(left) * BigInt(right);
  if (result > BigInt(Number.MAX_SAFE_INTEGER) || result < BigInt(Number.MIN_SAFE_INTEGER)) {
    throw new ApiError(422, "AMOUNT_OUT_OF_RANGE", `${field} exceeds the supported integer range`);
  }
  return Number(result);
}
