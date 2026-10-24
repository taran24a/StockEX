export type ReplayLedgerEntryType =
  | "deposit"
  | "withdrawal"
  | "virtual_reset"
  | "reserve"
  | "release"
  | "trade_debit"
  | "trade_credit"
  | "fee";

export interface ReplayLedgerEntry {
  fillId: string | null;
  entryType: ReplayLedgerEntryType;
  amountPaise: number;
  createdAt?: Date | string;
}

export interface ReplayFill {
  id: string;
  symbol: string;
  side: "buy" | "sell";
  quantity: number;
  pricePaise: number;
  executedAt: Date | string;
  executionSequence: number;
}

export interface ReplayEvent {
  id: string;
  aggregateId: string;
  eventType: string;
  sequenceNumber: number;
  payload: Record<string, unknown>;
  createdAt: Date | string;
}

export interface RebuiltHolding {
  symbol: string;
  quantity: number;
  averageCostPaise: number;
}

export interface RebuiltPortfolio {
  cashBalancePaise: number;
  reservedBalancePaise: number;
  holdings: RebuiltHolding[];
}

export interface ReplayFrame extends RebuiltPortfolio {
  eventId: string;
  eventType: string;
  message: string;
  createdAt: string;
}

export function humanizeOrderEvent(eventType: string, payload: Record<string, unknown>): string {
  const symbol = typeof payload.symbol === "string" ? payload.symbol : "order";
  const quantity = typeof payload.quantity === "number" ? ` (${payload.quantity} shares)` : "";
  const reason = typeof payload.reason === "string"
    ? payload.reason
    : typeof payload.message === "string"
      ? payload.message
      : undefined;
  switch (eventType) {
    case "ORDER_VALIDATED":
      return `Order validation passed for ${symbol}${quantity}`;
    case "RISK_CHECK_PASSED":
      return `Pre-trade risk checks passed for ${symbol}`;
    case "RISK_CHECK_FAILED":
    case "RISK_REJECTED":
      return reason === undefined ? "Order rejected by a pre-trade risk rule" : `Order rejected: ${reason}`;
    case "ORDER_ACCEPTED":
      return `Order accepted for ${symbol}${quantity}`;
    case "ORDER_MATCHED":
      return `Order matching completed for ${symbol}`;
    case "ORDER_FILLED":
      return `Order fill executed${typeof payload.quantity === "number" ? ` for ${payload.quantity} shares` : ""}`;
    case "ORDER_PARTIALLY_FILLED":
      return "Order was partially filled";
    case "ORDER_OPEN":
      return "Order is resting in the order book";
    case "ORDER_CANCELLED":
      return reason === undefined ? "Order was cancelled" : `Order was cancelled: ${reason}`;
    default:
      return `Order event: ${eventType}`;
  }
}

function safeNumber(value: bigint, field: string): number {
  if (value > BigInt(Number.MAX_SAFE_INTEGER) || value < BigInt(Number.MIN_SAFE_INTEGER)) {
    throw new RangeError(`${field} exceeds the safe integer range`);
  }
  return Number(value);
}

function cashImpact(entry: ReplayLedgerEntry): bigint {
  return entry.entryType === "reserve" || entry.entryType === "release"
    ? 0n
    : BigInt(entry.amountPaise);
}

function applyFill(
  holdings: Map<string, RebuiltHolding>,
  fill: ReplayFill
): void {
  const current = holdings.get(fill.symbol);
  if (fill.side === "buy") {
    const oldQuantity = current?.quantity ?? 0;
    const nextQuantity = BigInt(oldQuantity) + BigInt(fill.quantity);
    const totalCost = BigInt(oldQuantity) * BigInt(current?.averageCostPaise ?? 0) +
      BigInt(fill.quantity) * BigInt(fill.pricePaise);
    holdings.set(fill.symbol, {
      symbol: fill.symbol,
      quantity: safeNumber(nextQuantity, "Holding quantity"),
      averageCostPaise: safeNumber((totalCost + nextQuantity / 2n) / nextQuantity, "Average cost")
    });
    return;
  }
  if (current === undefined || current.quantity < fill.quantity) {
    throw new RangeError(`Ledger replay would sell more ${fill.symbol} shares than held`);
  }
  const remainingQuantity = current.quantity - fill.quantity;
  if (remainingQuantity === 0) {
    holdings.delete(fill.symbol);
  } else {
    holdings.set(fill.symbol, { ...current, quantity: remainingQuantity });
  }
}

export function rebuildPortfolioFromLedger(
  entries: ReplayLedgerEntry[],
  fills: ReplayFill[],
  openingBalancePaise = 0
): RebuiltPortfolio {
  let cash = BigInt(openingBalancePaise);
  let reserved = 0n;
  for (const entry of entries) {
    cash += cashImpact(entry);
    if (entry.entryType === "reserve") {
      reserved -= BigInt(entry.amountPaise);
    } else if (entry.entryType === "release") {
      reserved -= BigInt(entry.amountPaise);
    }
  }
  const holdings = new Map<string, RebuiltHolding>();
  const lastResetAt = entries
    .filter((entry) => entry.entryType === "virtual_reset" && entry.createdAt !== undefined)
    .reduce<number | null>((latest, entry) => {
      const timestamp = new Date(entry.createdAt!).getTime();
      return latest === null || timestamp > latest ? timestamp : latest;
    }, null);
  for (const fill of [...fills]
    .filter((candidate) => lastResetAt === null || new Date(candidate.executedAt).getTime() > lastResetAt)
    .sort((a, b) => a.executionSequence - b.executionSequence)) {
    applyFill(holdings, fill);
  }
  return {
    cashBalancePaise: safeNumber(cash, "Cash balance"),
    reservedBalancePaise: safeNumber(reserved, "Reserved balance"),
    holdings: [...holdings.values()].sort((a, b) => a.symbol.localeCompare(b.symbol))
  };
}

export function replayPortfolioEvents(
  initialCashBalancePaise: number,
  accountEvents: ReplayEvent[],
  targetOrderEvents: ReplayEvent[],
  entries: ReplayLedgerEntry[],
  fills: ReplayFill[]
): ReplayFrame[] {
  const eventsByFill = new Map(fills.map((fill) => [fill.id, fill]));
  const fillSequenceById = new Map(fills.map((fill) => [fill.id, fill.executionSequence]));
  const ledgerByFill = new Map<string, ReplayLedgerEntry[]>();
  for (const entry of entries) {
    if (entry.fillId === null) {
      continue;
    }
    const current = ledgerByFill.get(entry.fillId) ?? [];
    current.push(entry);
    ledgerByFill.set(entry.fillId, current);
  }
  const targetIds = new Set(targetOrderEvents.map((event) => event.id));
  const targetsById = new Map(targetOrderEvents.map((event) => [event.id, event]));
  const holdings = new Map<string, RebuiltHolding>();
  const processedFillIds = new Set<string>();
  let cash = BigInt(initialCashBalancePaise);
  let reserved = 0n;
  const frames: ReplayFrame[] = [];

  for (const event of [...accountEvents].sort((a, b) => {
    if (a.aggregateId === b.aggregateId) {
      return a.sequenceNumber - b.sequenceNumber;
    }
    const aFillSequence = typeof a.payload.fillId === "string"
      ? fillSequenceById.get(a.payload.fillId)
      : undefined;
    const bFillSequence = typeof b.payload.fillId === "string"
      ? fillSequenceById.get(b.payload.fillId)
      : undefined;
    if (aFillSequence !== undefined && bFillSequence !== undefined && aFillSequence !== bFillSequence) {
      return aFillSequence - bFillSequence;
    }
    const timeDelta = new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
    if (timeDelta !== 0) {
      return timeDelta;
    }
    const aggregateDelta = a.aggregateId.localeCompare(b.aggregateId);
    return aggregateDelta === 0 ? a.sequenceNumber - b.sequenceNumber : aggregateDelta;
  })) {
    if (
      (event.eventType === "ORDER_FILLED" || event.eventType === "ORDER_PARTIALLY_FILLED") &&
      typeof event.payload.fillId === "string"
    ) {
      const fillId = event.payload.fillId;
      const fill = eventsByFill.get(fillId);
      if (fill !== undefined && !processedFillIds.has(fillId)) {
        applyFill(holdings, fill);
        for (const entry of ledgerByFill.get(fillId) ?? []) {
          cash += cashImpact(entry);
        }
        processedFillIds.add(fillId);
      }
    }
    if (event.eventType === "ORDER_OPEN" && typeof event.payload.reservedAmountPaise === "number") {
      reserved += BigInt(event.payload.reservedAmountPaise);
    }
    if (event.eventType === "ORDER_CANCELLED" && typeof event.payload.releasedReservationPaise === "number") {
      reserved -= BigInt(event.payload.releasedReservationPaise);
    }
    if (!targetIds.has(event.id)) {
      continue;
    }
    const target = targetsById.get(event.id);
    if (target === undefined) {
      continue;
    }
    frames.push({
      eventId: target.id,
      eventType: target.eventType,
      message: humanizeOrderEvent(target.eventType, target.payload),
      createdAt: new Date(target.createdAt).toISOString(),
      cashBalancePaise: safeNumber(cash, "Replay cash balance"),
      reservedBalancePaise: safeNumber(reserved, "Replay reserved balance"),
      holdings: [...holdings.values()].sort((a, b) => a.symbol.localeCompare(b.symbol))
    });
  }
  return frames;
}
