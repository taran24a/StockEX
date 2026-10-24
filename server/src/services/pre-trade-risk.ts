export interface PreTradeRiskRules {
  maxOrderNotionalPaise: number;
  maxSingleStockConcentrationPct: number;
  maxSectorConcentrationPct: number;
}

export interface ExistingRiskHolding {
  symbol: string;
  sector: string;
  marketValuePaise: number;
}

export interface PreTradeRiskInput {
  symbol: string;
  sector: string;
  side: "buy" | "sell";
  orderNotionalPaise: number;
  totalEquityPaise: number;
  holdings: ExistingRiskHolding[];
}

export interface RiskRejection {
  rule: "MAX_ORDER_NOTIONAL" | "MAX_SINGLE_STOCK_CONCENTRATION" | "MAX_SECTOR_CONCENTRATION";
  message: string;
  currentPct?: number;
  projectedPct?: number;
}

export const DEFAULT_PRE_TRADE_RISK_RULES: PreTradeRiskRules = {
  maxOrderNotionalPaise: 10_000_000,
  maxSingleStockConcentrationPct: 45,
  maxSectorConcentrationPct: 45
};

function roundedPercent(numerator: bigint, denominator: bigint): number {
  if (denominator <= 0n) {
    return 0;
  }
  return Number((numerator * 10_000n + denominator / 2n) / denominator) / 100;
}

function exceedsConcentrationLimit(exposure: bigint, equity: bigint, limitPct: number): boolean {
  return exposure * 10_000n > equity * BigInt(Math.round(limitPct * 100));
}

function formatRupees(paise: number): string {
  const whole = Math.floor(paise / 100);
  const fraction = paise % 100;
  return `₹${whole}.${fraction.toString().padStart(2, "0")}`;
}

function projectedConcentration(
  currentExposure: bigint,
  orderNotional: bigint,
  side: "buy" | "sell",
  totalEquity: bigint,
  limitPct: number,
  label: string,
  rule: RiskRejection["rule"]
): RiskRejection | null {
  const direction = side === "buy" ? orderNotional : -orderNotional;
  const projectedExposure = inputSideExposure(currentExposure + direction);
  const currentPct = roundedPercent(currentExposure, totalEquity);
  const projectedPct = roundedPercent(projectedExposure, totalEquity);
  const limitBasisPoints = Math.round(limitPct * 100);

  if (projectedExposure * 10_000n > totalEquity * BigInt(limitBasisPoints)) {
    return {
      rule,
      message: `This trade would raise ${label} from ${currentPct}% to ${projectedPct}%, exceeding your ${limitPct}% limit`,
      currentPct,
      projectedPct
    };
  }

  function inputSideExposure(exposure: bigint): bigint {
    return exposure < 0n ? 0n : exposure;
  }
  return null;
}

export function evaluatePreTradeRisk(
  input: PreTradeRiskInput,
  rules: PreTradeRiskRules
): RiskRejection | null {
  if (!Number.isSafeInteger(input.orderNotionalPaise) || input.orderNotionalPaise <= 0) {
    throw new RangeError("Order notional must be a positive safe integer");
  }
  for (const [name, value] of Object.entries(rules)) {
    if (!Number.isFinite(value) || value <= 0 || (name !== "maxOrderNotionalPaise" && value > 100)) {
      throw new RangeError(`Risk rule ${name} is invalid`);
    }
  }
  if (!Number.isSafeInteger(input.totalEquityPaise) || input.totalEquityPaise < 0) {
    throw new RangeError("Total equity must be a nonnegative safe integer");
  }
  if (input.orderNotionalPaise > rules.maxOrderNotionalPaise) {
    return {
      rule: "MAX_ORDER_NOTIONAL",
      message: `Order notional ${formatRupees(input.orderNotionalPaise)} exceeds your ${formatRupees(rules.maxOrderNotionalPaise)} maximum`
    };
  }
  if (input.totalEquityPaise === 0) {
    return null;
  }

  const orderNotional = BigInt(input.orderNotionalPaise);
  const totalEquity = BigInt(input.totalEquityPaise);
  const stockExposure = input.holdings
    .filter((holding) => holding.symbol === input.symbol)
    .reduce((total, holding) => total + BigInt(holding.marketValuePaise), 0n);
  const stockRejection = projectedConcentration(
    stockExposure,
    orderNotional,
    input.side,
    totalEquity,
    rules.maxSingleStockConcentrationPct,
    input.symbol,
    "MAX_SINGLE_STOCK_CONCENTRATION"
  );
  if (stockRejection !== null) {
    return stockRejection;
  }

  const sectorExposure = input.holdings
    .filter((holding) => holding.sector === input.sector)
    .reduce((total, holding) => total + BigInt(holding.marketValuePaise), 0n);
  return projectedConcentration(
    sectorExposure,
    orderNotional,
    input.side,
    totalEquity,
    rules.maxSectorConcentrationPct,
    input.sector,
    "MAX_SECTOR_CONCENTRATION"
  );
}

export function findRiskWarnings(
  holdings: ExistingRiskHolding[],
  totalEquityPaise: number,
  rules: PreTradeRiskRules
): string[] {
  if (totalEquityPaise <= 0) {
    return [];
  }
  const totalEquity = BigInt(totalEquityPaise);
  const warnings: string[] = [];
  for (const holding of holdings) {
    const exposure = BigInt(holding.marketValuePaise);
    const concentrationPct = roundedPercent(exposure, totalEquity);
    if (exceedsConcentrationLimit(exposure, totalEquity, rules.maxSingleStockConcentrationPct)) {
      warnings.push(`${holding.symbol} is at ${concentrationPct}%, above your ${rules.maxSingleStockConcentrationPct}% single-stock limit`);
    }
  }
  const sectorExposure = new Map<string, bigint>();
  for (const holding of holdings) {
    sectorExposure.set(
      holding.sector,
      (sectorExposure.get(holding.sector) ?? 0n) + BigInt(holding.marketValuePaise)
    );
  }
  for (const [sector, exposure] of sectorExposure) {
    const concentrationPct = roundedPercent(exposure, totalEquity);
    if (exceedsConcentrationLimit(exposure, totalEquity, rules.maxSectorConcentrationPct)) {
      warnings.push(`${sector} is at ${concentrationPct}%, above your ${rules.maxSectorConcentrationPct}% sector limit`);
    }
  }
  return warnings;
}
