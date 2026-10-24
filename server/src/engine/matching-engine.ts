export type OrderSide = "buy" | "sell";

export interface Position {
  symbol: string;
  quantity: number;
  averageCostPaise: number;
}

export interface MarketOrder {
  symbol: string;
  side: OrderSide;
  quantity: number;
}

export interface Execution {
  order: MarketOrder & {
    pricePaise: number;
    totalPaise: number;
  };
  balancePaise: number;
  position: Position | null;
  profitLossPaise: number;
}

export type MatchingErrorCode =
  | "INVALID_ORDER"
  | "INVALID_BALANCE"
  | "INVALID_PRICE"
  | "INSUFFICIENT_FUNDS"
  | "INSUFFICIENT_SHARES"
  | "AMOUNT_OUT_OF_RANGE";

export class MatchingError extends Error {
  constructor(public readonly code: MatchingErrorCode, message: string) {
    super(message);
    this.name = "MatchingError";
  }
}

function toSafeInteger(value: bigint): number {
  if (value > BigInt(Number.MAX_SAFE_INTEGER) || value < BigInt(Number.MIN_SAFE_INTEGER)) {
    throw new MatchingError("AMOUNT_OUT_OF_RANGE", "Order amount exceeds the supported integer range");
  }
  return Number(value);
}

export function executeMarketOrder(
  order: MarketOrder,
  pricePaise: number,
  balancePaise: number,
  currentPosition: Position | null
): Execution {
  if (
    !Number.isSafeInteger(order.quantity) ||
    order.quantity <= 0 ||
    !/^[A-Z][A-Z0-9.-]{0,11}$/.test(order.symbol) ||
    (order.side !== "buy" && order.side !== "sell")
  ) {
    throw new MatchingError("INVALID_ORDER", "Order quantity and symbol are invalid");
  }
  if (!Number.isSafeInteger(balancePaise) || balancePaise < 0) {
    throw new MatchingError("INVALID_BALANCE", "Wallet balance is invalid");
  }
  if (!Number.isSafeInteger(pricePaise) || pricePaise <= 0) {
    throw new MatchingError("INVALID_PRICE", "Market price must be a positive integer number of paise");
  }
  if (
    currentPosition !== null &&
    (!Number.isSafeInteger(currentPosition.quantity) ||
      currentPosition.quantity <= 0 ||
      !Number.isSafeInteger(currentPosition.averageCostPaise) ||
      currentPosition.averageCostPaise < 0 ||
      currentPosition.symbol !== order.symbol)
  ) {
    throw new MatchingError("INVALID_ORDER", "Current position is invalid");
  }

  const quantity = BigInt(order.quantity);
  const price = BigInt(pricePaise);
  const totalPaise = toSafeInteger(quantity * price);
  let nextBalance = BigInt(balancePaise);
  let nextPosition = currentPosition;
  let profitLossPaise = 0;

  if (order.side === "buy") {
    if (nextBalance < BigInt(totalPaise)) {
      throw new MatchingError("INSUFFICIENT_FUNDS", "Insufficient virtual balance for this order");
    }
    nextBalance -= BigInt(totalPaise);

    const priorQuantity = BigInt(currentPosition?.quantity ?? 0);
    const priorCost = priorQuantity * BigInt(currentPosition?.averageCostPaise ?? 0);
    const nextQuantity = priorQuantity + quantity;
    const weightedCost = priorCost + BigInt(totalPaise);
    const roundedAverage = (weightedCost + nextQuantity / 2n) / nextQuantity;

    nextPosition = {
      symbol: order.symbol,
      quantity: toSafeInteger(nextQuantity),
      averageCostPaise: toSafeInteger(roundedAverage)
    };
  } else {
    if (currentPosition === null || currentPosition.quantity < order.quantity) {
      throw new MatchingError("INSUFFICIENT_SHARES", "Insufficient shares to sell");
    }
    nextBalance += BigInt(totalPaise);
    profitLossPaise = toSafeInteger(
      quantity * (price - BigInt(currentPosition.averageCostPaise))
    );
    const remainingQuantity = currentPosition.quantity - order.quantity;
    nextPosition = remainingQuantity === 0
      ? null
      : { ...currentPosition, quantity: remainingQuantity };
  }

  return {
    order: { ...order, pricePaise, totalPaise },
    balancePaise: toSafeInteger(nextBalance),
    position: nextPosition,
    profitLossPaise
  };
}
