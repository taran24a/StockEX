import { describe, expect, it } from "vitest";
import { formatPaise } from "./format";

describe("formatPaise", () => {
  it("formats paise without converting money to fractional rupees", () => {
    expect(formatPaise(100_000_000)).toBe("₹10,00,000.00");
    expect(formatPaise(12_345)).toBe("₹123.45");
    expect(formatPaise(-5)).toBe("−₹0.05");
  });

  it("rejects fractional or unsafe paise values", () => {
    expect(() => formatPaise(1.5)).toThrow(RangeError);
    expect(() => formatPaise(Number.MAX_SAFE_INTEGER + 1)).toThrow(RangeError);
  });
});
