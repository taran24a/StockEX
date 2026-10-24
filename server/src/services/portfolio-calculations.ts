import type {
  AccountHolding,
  EquityCurvePoint,
  PortfolioPerformanceResponse
} from "@tradewise/shared";

export interface PortfolioHoldingInput {
  instrumentId: string;
  symbol: string;
  quantity: number;
  averageCostPaise: number;
  marketPricePaise: number;
  dayChangePaise: number;
}

export interface EquitySnapshotInput {
  timestamp: Date | string;
  equityPaise: number;
}

export interface PositionBalance {
  quantity: number;
  averageCostPaise: number;
}

function checkedNumber(value: bigint, description: string): number {
  if (value > BigInt(Number.MAX_SAFE_INTEGER) || value < BigInt(Number.MIN_SAFE_INTEGER)) {
    throw new RangeError(`${description} exceeds the supported integer range`);
  }
  return Number(value);
}

export function calculatePositionAfterBuy(
  current: PositionBalance | null,
  fillQuantity: number,
  fillPricePaise: number
): PositionBalance {
  const currentQuantity = current?.quantity ?? 0;
  const currentAverageCost = current?.averageCostPaise ?? 0;
  const nextQuantity = BigInt(currentQuantity) + BigInt(fillQuantity);
  const totalCost = BigInt(currentQuantity) * BigInt(currentAverageCost) +
    BigInt(fillQuantity) * BigInt(fillPricePaise);
  return {
    quantity: checkedNumber(nextQuantity, "Position quantity"),
    averageCostPaise: checkedNumber((totalCost + nextQuantity / 2n) / nextQuantity, "Average position cost")
  };
}

export function calculatePositionAfterSell(
  current: PositionBalance,
  fillQuantity: number,
  fillPricePaise: number
): PositionBalance & { realizedPnlPaise: number } {
  if (fillQuantity > current.quantity) {
    throw new RangeError("Sell quantity exceeds the current position");
  }
  return {
    quantity: current.quantity - fillQuantity,
    averageCostPaise: current.averageCostPaise,
    realizedPnlPaise: checkedNumber(
      (BigInt(fillPricePaise) - BigInt(current.averageCostPaise)) * BigInt(fillQuantity),
      "Realized P&L"
    )
  };
}

export function calculateDayChangePaise(currentPricePaise: number, previousClosePaise: number | null): number {
  if (previousClosePaise === null) {
    return 0;
  }
  return checkedNumber(
    BigInt(currentPricePaise) - BigInt(previousClosePaise),
    "Instrument day change"
  );
}

export function calculatePortfolio(
  cashBalancePaise: number,
  reservedBalancePaise: number,
  holdingInputs: PortfolioHoldingInput[]
): {
  holdings: AccountHolding[];
  totalEquityPaise: number;
} {
  const holdings = holdingInputs.map((holding) => {
    const marketValuePaise = checkedNumber(
      BigInt(holding.quantity) * BigInt(holding.marketPricePaise),
      "Holding market value"
    );
    const costBasisPaise = BigInt(holding.quantity) * BigInt(holding.averageCostPaise);
    return {
      instrumentId: holding.instrumentId,
      symbol: holding.symbol,
      quantity: holding.quantity,
      averageCostPaise: holding.averageCostPaise,
      marketPricePaise: holding.marketPricePaise,
      marketValuePaise,
      unrealizedPnlPaise: checkedNumber(
        BigInt(marketValuePaise) - costBasisPaise,
        "Holding unrealized P&L"
      )
    };
  });
  const marketValue = holdings.reduce((sum, holding) => sum + BigInt(holding.marketValuePaise), 0n);

  if (
    !Number.isSafeInteger(cashBalancePaise) ||
    cashBalancePaise < 0 ||
    !Number.isSafeInteger(reservedBalancePaise) ||
    reservedBalancePaise < 0 ||
    reservedBalancePaise > cashBalancePaise
  ) {
    throw new RangeError("Portfolio cash and reservation balances are invalid");
  }

  return {
    holdings,
    totalEquityPaise: checkedNumber(BigInt(cashBalancePaise) + marketValue, "Portfolio equity")
  };
}

export function calculatePortfolioPerformance(
  realizedPnlSnapshotsPaise: number[],
  holdings: PortfolioHoldingInput[],
  equitySnapshots: EquitySnapshotInput[]
): PortfolioPerformanceResponse {
  const realizedPnlPaise = checkedNumber(
    realizedPnlSnapshotsPaise.reduce((sum, amount) => sum + BigInt(amount), 0n),
    "Portfolio realized P&L"
  );
  const unrealizedPnl = holdings.reduce((sum, holding) => {
    const marketValue = BigInt(holding.quantity) * BigInt(holding.marketPricePaise);
    const costBasis = BigInt(holding.quantity) * BigInt(holding.averageCostPaise);
    return sum + marketValue - costBasis;
  }, 0n);
  const holdingContributions = holdings.map((holding) => ({
    symbol: holding.symbol,
    dayChangeContributionPaise: checkedNumber(
      BigInt(holding.quantity) * BigInt(holding.dayChangePaise),
      "Holding day-change contribution"
    )
  }));
  const equityCurve: EquityCurvePoint[] = equitySnapshots.map((snapshot) => ({
    timestamp: (snapshot.timestamp instanceof Date ? snapshot.timestamp : new Date(snapshot.timestamp)).toISOString(),
    equityPaise: snapshot.equityPaise
  }));

  return {
    realizedPnlPaise,
    unrealizedPnlPaise: checkedNumber(unrealizedPnl, "Portfolio unrealized P&L"),
    dayChangePaise: holdingContributions.reduce(
      (sum, holding) => checkedNumber(
        BigInt(sum) + BigInt(holding.dayChangeContributionPaise),
        "Portfolio day change"
      ),
      0
    ),
    holdingContributions,
    equityCurve
  };
}
