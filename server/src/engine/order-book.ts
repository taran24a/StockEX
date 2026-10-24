export type OrderSide = "buy" | "sell";
export type OrderType = "market" | "limit";
export type OrderStatus = "pending" | "open" | "partially_filled" | "filled" | "cancelled" | "rejected";

export interface NewOrder {
  id: string;
  symbol: string;
  side: OrderSide;
  type: OrderType;
  quantity: number;
  limitPricePaise?: number;
}

export interface OrderState extends NewOrder {
  status: OrderStatus;
  filledQuantity: number;
  remainingQuantity: number;
  reason?: string;
}

export interface Fill {
  symbol: string;
  makerOrderId: string;
  takerOrderId: string;
  pricePaise: number;
  quantity: number;
}

export interface MatchResult {
  fills: Fill[];
  orders: OrderState[];
}

const allowedTransitions: Readonly<Record<OrderStatus, readonly OrderStatus[]>> = {
  pending: ["open", "cancelled", "rejected"],
  open: ["partially_filled", "filled", "cancelled", "rejected"],
  partially_filled: ["filled", "cancelled", "rejected"],
  filled: ["rejected"],
  cancelled: ["rejected"],
  rejected: []
};

export class InvalidOrderTransitionError extends Error {
  constructor(from: OrderStatus, to: OrderStatus) {
    super(`Order cannot transition from ${from} to ${to}`);
    this.name = "InvalidOrderTransitionError";
  }
}

export class OrderBookError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OrderBookError";
  }
}

export function transitionOrderStatus(order: OrderState, next: OrderStatus, reason?: string): OrderState {
  if (!allowedTransitions[order.status].includes(next)) {
    throw new InvalidOrderTransitionError(order.status, next);
  }
  order.status = next;
  if (reason === undefined) {
    delete order.reason;
  } else {
    order.reason = reason;
  }
  return order;
}

function validateOrder(order: NewOrder, symbol: string): string | undefined {
  if (!/^[A-Z][A-Z0-9.-]{0,31}$/.test(order.symbol) || order.symbol !== symbol) {
    return "Order symbol does not match this order book";
  }
  if (order.id.trim().length === 0) {
    return "Order ID must not be empty";
  }
  if (!Number.isSafeInteger(order.quantity) || order.quantity <= 0) {
    return "Order quantity must be a positive safe integer";
  }
  if (order.side !== "buy" && order.side !== "sell") {
    return "Order side must be buy or sell";
  }
  if (order.type !== "market" && order.type !== "limit") {
    return "Order type must be market or limit";
  }
  if (order.type === "limit" && (!Number.isSafeInteger(order.limitPricePaise) || (order.limitPricePaise ?? 0) <= 0)) {
    return "Limit orders require a positive integer paise price";
  }
  if (order.type === "market" && order.limitPricePaise !== undefined) {
    return "Market orders cannot specify a limit price";
  }
  return undefined;
}

function cloneOrder(order: OrderState): OrderState {
  return { ...order };
}

export class OrderBook {
  private readonly orders = new Map<string, OrderState>();
  private arrivalSequence = 0;

  constructor(readonly symbol: string) {
    if (!/^[A-Z][A-Z0-9.-]{0,31}$/.test(symbol)) {
      throw new OrderBookError("Order book symbol is invalid");
    }
  }

  match(order: NewOrder): MatchResult {
    const invalidReason = validateOrder(order, this.symbol);
    if (invalidReason !== undefined) {
      const rejected = this.rejectOrder(order, invalidReason);
      return { fills: [], orders: [cloneOrder(rejected)] };
    }
    if (this.orders.has(order.id)) {
      const rejected = this.rejectOrder(order, "Order ID already exists in this book");
      return { fills: [], orders: [cloneOrder(rejected)] };
    }

    const incoming = this.createState(order);
    this.orders.set(incoming.id, incoming);
    transitionOrderStatus(incoming, "open");
    const changed = new Map<string, OrderState>([[incoming.id, incoming]]);
    const fills: Fill[] = [];

    while (incoming.remainingQuantity > 0) {
      const maker = this.bestCrossingOrder(incoming);
      if (maker === undefined) {
        break;
      }

      const quantity = Math.min(incoming.remainingQuantity, maker.remainingQuantity);
      const fill: Fill = {
        symbol: this.symbol,
        makerOrderId: maker.id,
        takerOrderId: incoming.id,
        pricePaise: maker.limitPricePaise!,
        quantity
      };
      fills.push(fill);
      incoming.filledQuantity += quantity;
      incoming.remainingQuantity -= quantity;
      maker.filledQuantity += quantity;
      maker.remainingQuantity -= quantity;
      changed.set(maker.id, maker);

      this.updateFillStatus(maker);
      this.updateFillStatus(incoming);
    }

    if (incoming.remainingQuantity > 0) {
      if (incoming.type === "market") {
        transitionOrderStatus(incoming, "cancelled", "NO_LIQUIDITY");
      } else {
        this.arrivalSequence += 1;
        this.arrivalByOrderId.set(incoming.id, this.arrivalSequence);
      }
    }

    return {
      fills,
      orders: [...changed.values()].map(cloneOrder)
    };
  }

  cancel(orderId: string): OrderState {
    const order = this.orders.get(orderId);
    if (order === undefined) {
      throw new OrderBookError(`Order ${orderId} was not found`);
    }
    transitionOrderStatus(order, "cancelled");
    this.arrivalByOrderId.delete(order.id);
    return cloneOrder(order);
  }

  getOrder(orderId: string): OrderState | undefined {
    const order = this.orders.get(orderId);
    return order === undefined ? undefined : cloneOrder(order);
  }

  getOpenOrders(): OrderState[] {
    return [...this.orders.values()]
      .filter((order) => order.status === "open" || order.status === "partially_filled")
      .map(cloneOrder);
  }

  restore(order: NewOrder, filledQuantity: number, status: "open" | "partially_filled"): OrderState {
    const invalidReason = validateOrder(order, this.symbol);
    if (invalidReason !== undefined) {
      throw new OrderBookError(invalidReason);
    }
    if (this.orders.has(order.id)) {
      throw new OrderBookError(`Order ${order.id} is already in this book`);
    }
    if (!Number.isSafeInteger(filledQuantity) || filledQuantity < 0 || filledQuantity >= order.quantity) {
      throw new OrderBookError("Restored order fill quantity is invalid");
    }
    const state = this.createState(order);
    state.filledQuantity = filledQuantity;
    state.remainingQuantity = order.quantity - filledQuantity;
    transitionOrderStatus(state, "open");
    if (status === "partially_filled") {
      transitionOrderStatus(state, "partially_filled");
    } else if (filledQuantity !== 0) {
      throw new OrderBookError("An open order cannot already have a filled quantity");
    }
    this.orders.set(state.id, state);
    this.arrivalSequence += 1;
    this.arrivalByOrderId.set(state.id, this.arrivalSequence);
    return cloneOrder(state);
  }

  private readonly arrivalByOrderId = new Map<string, number>();

  private createState(order: NewOrder, status: OrderStatus = "pending", reason?: string): OrderState {
    const state: OrderState = {
      ...order,
      status,
      filledQuantity: 0,
      remainingQuantity: Number.isSafeInteger(order.quantity) ? order.quantity : 0
    };
    if (reason !== undefined) {
      state.reason = reason;
    }
    return state;
  }

  private rejectOrder(order: NewOrder, reason: string): OrderState {
    const rejected = this.createState(order);
    transitionOrderStatus(rejected, "rejected", reason);
    return rejected;
  }

  private updateFillStatus(order: OrderState): void {
    if (order.remainingQuantity === 0) {
      transitionOrderStatus(order, "filled");
    } else if (order.status === "open") {
      transitionOrderStatus(order, "partially_filled");
    }
  }

  private bestCrossingOrder(incoming: OrderState): OrderState | undefined {
    const oppositeSide: OrderSide = incoming.side === "buy" ? "sell" : "buy";
    const candidates = [...this.orders.values()]
      .filter((order) =>
        order.side === oppositeSide &&
        (order.status === "open" || order.status === "partially_filled") &&
        order.remainingQuantity > 0 &&
        order.type === "limit" &&
        this.pricesCross(incoming, order)
      )
      .sort((left, right) => {
        const leftPrice = left.limitPricePaise!;
        const rightPrice = right.limitPricePaise!;
        const priceOrder = incoming.side === "buy"
          ? leftPrice < rightPrice ? -1 : leftPrice > rightPrice ? 1 : 0
          : leftPrice > rightPrice ? -1 : leftPrice < rightPrice ? 1 : 0;
        return priceOrder || (this.arrivalByOrderId.get(left.id)! - this.arrivalByOrderId.get(right.id)!);
      });
    return candidates[0];
  }

  private pricesCross(incoming: OrderState, resting: OrderState): boolean {
    if (incoming.type === "market") {
      return true;
    }
    return incoming.side === "buy"
      ? incoming.limitPricePaise! >= resting.limitPricePaise!
      : incoming.limitPricePaise! <= resting.limitPricePaise!;
  }
}
