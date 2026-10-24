import { describe, expect, it } from "vitest";
import {
  humanizeOrderEvent,
  rebuildPortfolioFromLedger,
  replayPortfolioEvents
} from "./portfolio-replay.js";
import type {
  ReplayEvent,
  ReplayFill,
  ReplayLedgerEntry
} from "./portfolio-replay.js";

const fills: ReplayFill[] = [
  {
    id: "fill-a",
    symbol: "ALFA",
    side: "buy",
    quantity: 10,
    pricePaise: 100,
    executedAt: "2026-10-25T10:00:00.000Z",
    executionSequence: 1
  },
  {
    id: "fill-b",
    symbol: "ALFA",
    side: "buy",
    quantity: 5,
    pricePaise: 160,
    executedAt: "2026-10-25T10:01:00.000Z",
    executionSequence: 2
  },
  {
    id: "fill-c",
    symbol: "ALFA",
    side: "sell",
    quantity: 8,
    pricePaise: 200,
    executedAt: "2026-10-25T10:02:00.000Z",
    executionSequence: 3
  }
];

const entries: ReplayLedgerEntry[] = [
  { fillId: null, entryType: "deposit", amountPaise: 10_000 },
  { fillId: "fill-a", entryType: "trade_debit", amountPaise: -1_000 },
  { fillId: "fill-a", entryType: "fee", amountPaise: -1 },
  { fillId: "fill-b", entryType: "trade_debit", amountPaise: -800 },
  { fillId: "fill-b", entryType: "fee", amountPaise: -1 },
  { fillId: "fill-c", entryType: "trade_credit", amountPaise: 1_600 },
  { fillId: "fill-c", entryType: "fee", amountPaise: -1 },
  { fillId: null, entryType: "reserve", amountPaise: -500 },
  { fillId: null, entryType: "release", amountPaise: 500 }
];

describe("portfolio ledger rebuild and order replay", () => {
  it("rebuilds the cash and position projection after sequential buys and a partial sell", () => {
    const rebuilt = rebuildPortfolioFromLedger(entries, fills);

    expect(rebuilt).toEqual({
      cashBalancePaise: 9_797,
      reservedBalancePaise: 0,
      holdings: [{ symbol: "ALFA", quantity: 7, averageCostPaise: 120 }]
    });
    expect(rebuilt.cashBalancePaise).toBe(9_797);
    expect(rebuilt.holdings).toEqual([
      { symbol: "ALFA", quantity: 7, averageCostPaise: 120 }
    ]);
  });

  it("applies virtual resets to cash and excludes fills before the reset from live holdings", () => {
    const rebuilt = rebuildPortfolioFromLedger([
      { fillId: null, entryType: "deposit", amountPaise: 10_000 },
      { fillId: "fill-a", entryType: "trade_debit", amountPaise: -1_000 },
      {
        fillId: null,
        entryType: "virtual_reset",
        amountPaise: 1_000,
        createdAt: "2026-10-25T10:30:00.000Z"
      }
    ], fills.slice(0, 1));

    expect(rebuilt).toEqual({
      cashBalancePaise: 10_000,
      reservedBalancePaise: 0,
      holdings: []
    });
  });

  it("produces account projection frames as order fill events are replayed", () => {
    const events: ReplayEvent[] = [
      {
        id: "event-validated",
        aggregateId: "order-buy",
        eventType: "ORDER_VALIDATED",
        sequenceNumber: 1,
        payload: { symbol: "ALFA", quantity: 10 },
        createdAt: "2026-10-25T10:00:00.000Z"
      },
      {
        id: "event-fill",
        aggregateId: "order-buy",
        eventType: "ORDER_FILLED",
        sequenceNumber: 2,
        payload: { fillId: "fill-a", quantity: 10 },
        createdAt: "2026-10-25T10:00:01.000Z"
      }
    ];
    const frames = replayPortfolioEvents(
      10_000,
      events,
      events,
      entries,
      fills
    );

    expect(frames).toHaveLength(2);
    expect(frames[0]).toMatchObject({
      eventType: "ORDER_VALIDATED",
      cashBalancePaise: 10_000,
      holdings: []
    });
    expect(frames[1]).toMatchObject({
      eventType: "ORDER_FILLED",
      cashBalancePaise: 8_999,
      holdings: [{ symbol: "ALFA", quantity: 10, averageCostPaise: 100 }]
    });
  });

  it("formats risk, matching, fill, and cancellation events for a timeline", () => {
    expect(humanizeOrderEvent("RISK_REJECTED", { reason: "above your limit" }))
      .toBe("Order rejected: above your limit");
    expect(humanizeOrderEvent("ORDER_MATCHED", { symbol: "ALFA" }))
      .toBe("Order matching completed for ALFA");
    expect(humanizeOrderEvent("ORDER_FILLED", { quantity: 10 }))
      .toBe("Order fill executed for 10 shares");
    expect(humanizeOrderEvent("ORDER_CANCELLED", { reason: "USER_CANCELLED" }))
      .toBe("Order was cancelled: USER_CANCELLED");
  });

  it("rejects replay sequences that sell more shares than were acquired", () => {
    expect(() => rebuildPortfolioFromLedger([], [{
      id: "fill-short",
      symbol: "ALFA",
      side: "sell",
      quantity: 1,
      pricePaise: 100,
      executedAt: "2026-10-25T10:00:00.000Z",
      executionSequence: 1
    }])).toThrow("Ledger replay would sell more ALFA shares than held");
  });
});
