import { describe, expect, it } from "vitest";
import {
  calculateDayChangePaise,
  calculatePositionAfterBuy,
  calculatePositionAfterSell,
  calculatePortfolio,
  calculatePortfolioPerformance
} from "./portfolio-calculations.js";

const holding = {
  instrumentId: "4b8fbe96-52f4-45b9-a373-195af22bcf22",
  symbol: "ALFA",
  quantity: 5,
  averageCostPaise: 100,
  marketPricePaise: 125,
  dayChangePaise: 10
};

describe("portfolio calculations", () => {
  it("updates average cost by quantity-weighted buy fills", () => {
    expect(calculatePositionAfterBuy(
      { quantity: 2, averageCostPaise: 100 },
      3,
      130
    )).toEqual({ quantity: 5, averageCostPaise: 118 });
  });

  it("keeps average cost on partial sells and records realized profit or loss", () => {
    expect(calculatePositionAfterSell(
      { quantity: 5, averageCostPaise: 100 },
      2,
      125
    )).toEqual({
      quantity: 3,
      averageCostPaise: 100,
      realizedPnlPaise: 50
    });
    expect(calculatePositionAfterSell(
      { quantity: 5, averageCostPaise: 100 },
      2,
      75
    ).realizedPnlPaise).toBe(-50);
  });

  it("clears all shares while retaining realized P&L on a full sell", () => {
    expect(calculatePositionAfterSell(
      { quantity: 2, averageCostPaise: 100 },
      2,
      110
    )).toEqual({ quantity: 0, averageCostPaise: 100, realizedPnlPaise: 20 });
  });

  it("calculates holdings market value and total equity without floats", () => {
    expect(calculatePortfolio(1_000, 200, [holding])).toEqual({
      holdings: [{
        instrumentId: holding.instrumentId,
        symbol: "ALFA",
        quantity: 5,
        averageCostPaise: 100,
        marketPricePaise: 125,
        marketValuePaise: 625,
        unrealizedPnlPaise: 125
      }],
      totalEquityPaise: 1_625
    });
  });

  it("calculates day change from the prior close and treats missing history as no change", () => {
    expect(calculateDayChangePaise(120, 100)).toBe(20);
    expect(calculateDayChangePaise(100, 120)).toBe(-20);
    expect(calculateDayChangePaise(120, null)).toBe(0);
  });

  it("calculates realized/unrealized P&L, holding contribution and ledger equity snapshots", () => {
    expect(calculatePortfolioPerformance([-30, 5], [holding], [
      { timestamp: new Date("2026-10-24T10:00:00.000Z"), equityPaise: 1_200 },
      { timestamp: new Date("2026-10-24T11:00:00.000Z"), equityPaise: 1_350 }
    ])).toEqual({
      realizedPnlPaise: -25,
      unrealizedPnlPaise: 125,
      dayChangePaise: 50,
      holdingContributions: [{ symbol: "ALFA", dayChangeContributionPaise: 50 }],
      equityCurve: [
        { timestamp: "2026-10-24T10:00:00.000Z", equityPaise: 1_200 },
        { timestamp: "2026-10-24T11:00:00.000Z", equityPaise: 1_350 }
      ]
    });
  });

  it("rejects reserved cash greater than the cash balance", () => {
    expect(() => calculatePortfolio(100, 101, [])).toThrow("Portfolio cash and reservation balances are invalid");
  });

  it("rejects a holding calculation outside the safe integer range", () => {
    expect(() => calculatePortfolio(0, 0, [{
      ...holding,
      quantity: Number.MAX_SAFE_INTEGER,
      marketPricePaise: 2
    }])).toThrow("Holding market value exceeds the supported integer range");
  });
});
