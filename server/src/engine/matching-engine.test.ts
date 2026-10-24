import { describe, expect, it } from "vitest";
import { executeMarketOrder, MatchingError } from "./matching-engine.js";

describe("executeMarketOrder", () => {
  it("buys shares, debits integer paise, and updates weighted cost", () => {
    const execution = executeMarketOrder(
      { symbol: "ALFA", side: "buy", quantity: 2 },
      101,
      1_000,
      { symbol: "ALFA", quantity: 2, averageCostPaise: 99 }
    );

    expect(execution.balancePaise).toBe(798);
    expect(execution.order.totalPaise).toBe(202);
    expect(execution.position).toEqual({
      symbol: "ALFA",
      quantity: 4,
      averageCostPaise: 100
    });
  });

  it("rejects a buy that exceeds the virtual balance", () => {
    expect(() => executeMarketOrder(
      { symbol: "ALFA", side: "buy", quantity: 2 },
      101,
      201,
      null
    )).toThrowError(new MatchingError("INSUFFICIENT_FUNDS", "Insufficient virtual balance for this order"));
  });

  it("sells held shares and removes a fully closed position", () => {
    const execution = executeMarketOrder(
      { symbol: "ALFA", side: "sell", quantity: 3 },
      120,
      10,
      { symbol: "ALFA", quantity: 3, averageCostPaise: 100 }
    );

    expect(execution.balancePaise).toBe(370);
    expect(execution.profitLossPaise).toBe(60);
    expect(execution.position).toBeNull();
  });

  it("rejects selling more shares than held", () => {
    expect(() => executeMarketOrder(
      { symbol: "ALFA", side: "sell", quantity: 2 },
      100,
      0,
      { symbol: "ALFA", quantity: 1, averageCostPaise: 100 }
    )).toThrowError("Insufficient shares to sell");
  });

  it("rejects amounts that cannot be represented safely", () => {
    expect(() => executeMarketOrder(
      { symbol: "ALFA", side: "buy", quantity: 2 },
      Number.MAX_SAFE_INTEGER,
      Number.MAX_SAFE_INTEGER,
      null
    )).toThrowError("Order amount exceeds the supported integer range");
  });
});
