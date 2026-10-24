import { describe, expect, it } from "vitest";
import {
  evaluatePreTradeRisk,
  findRiskWarnings
} from "./pre-trade-risk.js";
import type { PreTradeRiskRules } from "./pre-trade-risk.js";

const rules: PreTradeRiskRules = {
  maxOrderNotionalPaise: 1_000,
  maxSingleStockConcentrationPct: 45,
  maxSectorConcentrationPct: 45
};

describe("pre-trade risk evaluation", () => {
  it("rejects orders above the maximum notional", () => {
    const rejection = evaluatePreTradeRisk({
      symbol: "ALFA",
      sector: "Technology",
      side: "buy",
      orderNotionalPaise: 1_001,
      totalEquityPaise: 10_000,
      holdings: []
    }, rules);

    expect(rejection).toEqual({
      rule: "MAX_ORDER_NOTIONAL",
      message: "Order notional ₹10.01 exceeds your ₹10.00 maximum"
    });
  });

  it("rejects a buy that exceeds the single-stock concentration limit", () => {
    const rejection = evaluatePreTradeRisk({
      symbol: "ALFA",
      sector: "Technology",
      side: "buy",
      orderNotionalPaise: 200,
      totalEquityPaise: 1_000,
      holdings: [{ symbol: "ALFA", sector: "Technology", marketValuePaise: 300 }]
    }, rules);

    expect(rejection).toMatchObject({
      rule: "MAX_SINGLE_STOCK_CONCENTRATION",
      currentPct: 30,
      projectedPct: 50
    });
    expect(rejection?.message).toBe("This trade would raise ALFA from 30% to 50%, exceeding your 45% limit");
  });

  it("rejects a buy that raises sector concentration above its limit", () => {
    const rejection = evaluatePreTradeRisk({
      symbol: "ALFA",
      sector: "Technology",
      side: "buy",
      orderNotionalPaise: 170,
      totalEquityPaise: 1_000,
      holdings: [{ symbol: "BETA", sector: "Technology", marketValuePaise: 350 }]
    }, rules);

    expect(rejection).toMatchObject({
      rule: "MAX_SECTOR_CONCENTRATION",
      currentPct: 35,
      projectedPct: 52
    });
    expect(rejection?.message).toBe("This trade would raise Technology from 35% to 52%, exceeding your 45% limit");
  });

  it("does not reject a sell that reduces an existing concentration", () => {
    expect(evaluatePreTradeRisk({
      symbol: "ALFA",
      sector: "Technology",
      side: "sell",
      orderNotionalPaise: 200,
      totalEquityPaise: 1_000,
      holdings: [{ symbol: "ALFA", sector: "Technology", marketValuePaise: 500 }]
    }, rules)).toBeNull();
  });

  it("returns warnings for current stock and sector concentrations over configured limits", () => {
    expect(findRiskWarnings([
      { symbol: "ALFA", sector: "Technology", marketValuePaise: 500 },
      { symbol: "BETA", sector: "Technology", marketValuePaise: 100 }
    ], 1_000, rules)).toEqual([
      "ALFA is at 50%, above your 45% single-stock limit",
      "Technology is at 60%, above your 45% sector limit"
    ]);
  });
});
