import { describe, expect, it } from "vitest";
import {
  InvalidOrderTransitionError,
  OrderBook,
  transitionOrderStatus
} from "./order-book.js";
import type { NewOrder, OrderState } from "./order-book.js";

function limitOrder(
  id: string,
  side: "buy" | "sell",
  quantity: number,
  limitPricePaise: number
): NewOrder {
  return { id, symbol: "ALFA", side, type: "limit", quantity, limitPricePaise };
}

function marketOrder(id: string, side: "buy" | "sell", quantity: number): NewOrder {
  return { id, symbol: "ALFA", side, type: "market", quantity };
}

describe("OrderBook", () => {
  it("matches best price first and FIFO within a price level", () => {
    const book = new OrderBook("ALFA");
    book.match(limitOrder("ask-first", "sell", 1, 110));
    book.match(limitOrder("ask-second", "sell", 1, 110));
    book.match(limitOrder("best-ask", "sell", 1, 105));

    const result = book.match(marketOrder("buyer", "buy", 3));

    expect(result.fills.map(({ makerOrderId, pricePaise }) => [makerOrderId, pricePaise])).toEqual([
      ["best-ask", 105],
      ["ask-first", 110],
      ["ask-second", 110]
    ]);
    expect(result.orders.find(({ id }) => id === "buyer")?.status).toBe("filled");
  });

  it("keeps a partially filled limit order open with its remaining quantity", () => {
    const book = new OrderBook("ALFA");
    book.match(limitOrder("ask", "sell", 2, 100));

    const result = book.match(limitOrder("bid", "buy", 5, 105));

    expect(result.fills).toEqual([{
      symbol: "ALFA",
      makerOrderId: "ask",
      takerOrderId: "bid",
      pricePaise: 100,
      quantity: 2
    }]);
    expect(result.orders.find(({ id }) => id === "ask")).toMatchObject({
      status: "filled",
      filledQuantity: 2,
      remainingQuantity: 0
    });
    expect(result.orders.find(({ id }) => id === "bid")).toMatchObject({
      status: "partially_filled",
      filledQuantity: 2,
      remainingQuantity: 3
    });
    expect(book.getOpenOrders().map(({ id }) => id)).toEqual(["bid"]);
  });

  it("cancels a resting order and removes it from matching liquidity", () => {
    const book = new OrderBook("ALFA");
    book.match(limitOrder("ask", "sell", 2, 100));

    expect(book.cancel("ask").status).toBe("cancelled");
    const result = book.match(marketOrder("buyer", "buy", 1));

    expect(result.fills).toEqual([]);
    expect(result.orders[0]).toMatchObject({
      id: "buyer",
      status: "cancelled",
      reason: "NO_LIQUIDITY"
    });
  });

  it("does not cross the spread until the limit price reaches the opposite quote", () => {
    const book = new OrderBook("ALFA");
    book.match(limitOrder("ask", "sell", 1, 105));

    const nonCrossing = book.match(limitOrder("low-bid", "buy", 1, 100));
    expect(nonCrossing.fills).toEqual([]);
    expect(nonCrossing.orders[0]?.status).toBe("open");

    const crossing = book.match(limitOrder("crossing-bid", "buy", 1, 105));
    expect(crossing.fills).toEqual([{
      symbol: "ALFA",
      makerOrderId: "ask",
      takerOrderId: "crossing-bid",
      pricePaise: 105,
      quantity: 1
    }]);
    expect(book.getOrder("low-bid")?.status).toBe("open");
  });

  it("rejects invalid state transitions", () => {
    const openOrder: OrderState = {
      ...limitOrder("bid", "buy", 1, 100),
      status: "open",
      filledQuantity: 0,
      remainingQuantity: 1
    };

    expect(() => transitionOrderStatus(openOrder, "pending"))
      .toThrowError(InvalidOrderTransitionError);
  });

  it("cancels an unfilled market order when there is no liquidity", () => {
    const result = new OrderBook("ALFA").match(marketOrder("buyer", "buy", 3));

    expect(result.fills).toEqual([]);
    expect(result.orders[0]).toMatchObject({
      id: "buyer",
      status: "cancelled",
      filledQuantity: 0,
      remainingQuantity: 3,
      reason: "NO_LIQUIDITY"
    });
  });

  it("never executes a buy above or a sell below its limit", () => {
    const buyBook = new OrderBook("ALFA");
    buyBook.match(limitOrder("sell-maker", "sell", 1, 100));
    const buyFill = buyBook.match(limitOrder("buy-taker", "buy", 1, 101)).fills[0];
    expect(buyFill?.pricePaise).toBe(100);
    expect(buyFill?.pricePaise).toBeLessThanOrEqual(101);

    const sellBook = new OrderBook("ALFA");
    sellBook.match(limitOrder("buy-maker", "buy", 1, 101));
    const sellFill = sellBook.match(limitOrder("sell-taker", "sell", 1, 100)).fills[0];
    expect(sellFill?.pricePaise).toBe(101);
    expect(sellFill?.pricePaise).toBeGreaterThanOrEqual(100);
  });
});
