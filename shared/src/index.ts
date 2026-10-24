import { z } from "zod";

const paiseSchema = z.number().int().nonnegative().safe();
const positivePaiseSchema = z.number().int().positive().safe();
const symbolSchema = z.string().regex(/^[A-Z][A-Z0-9.-]{0,31}$/);
const quantitySchema = z.number().int().positive().safe();

export const HealthResponseSchema = z.object({
  status: z.literal("ok")
});

export const RegisterRequestSchema = z.object({
  email: z.email().max(254),
  displayName: z.string().trim().min(2).max(60),
  password: z.string().min(12).refine((value) => new TextEncoder().encode(value).byteLength <= 72, {
    message: "Password must be no more than 72 UTF-8 bytes"
  })
});

export const LoginRequestSchema = z.object({
  email: z.email().max(254),
  password: z.string().min(1).refine((value) => new TextEncoder().encode(value).byteLength <= 72, {
    message: "Password must be no more than 72 UTF-8 bytes"
  })
});

export const UserSchema = z.object({
  id: z.uuid(),
  email: z.email(),
  displayName: z.string(),
  role: z.enum(["user", "admin"])
});

export const AdminUserSchema = UserSchema.extend({
  createdAt: z.iso.datetime()
});

export const AdminUsersResponseSchema = z.object({
  users: z.array(AdminUserSchema)
});

export const AuthResponseSchema = z.object({
  token: z.string().min(1),
  expiresAt: z.iso.datetime(),
  user: UserSchema
});

export const InstrumentSchema = z.object({
  id: z.uuid(),
  symbol: symbolSchema,
  name: z.string().trim().min(1).max(120),
  sector: z.string().trim().min(1).max(80),
  tickSizePaise: positivePaiseSchema,
  lastPricePaise: positivePaiseSchema,
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime()
});

export const QuoteSchema = z.object({
  symbol: z.string().regex(/^[A-Z][A-Z0-9.-]{0,11}$/),
  name: z.string().min(1),
  pricePaise: positivePaiseSchema,
  changePaise: z.number().int().safe(),
  updatedAt: z.iso.datetime()
});

export const QuotesResponseSchema = z.object({
  quotes: z.array(QuoteSchema)
});

export const CandleSchema = z.object({
  instrumentId: z.uuid(),
  ts: z.iso.datetime(),
  openPaise: positivePaiseSchema,
  highPaise: positivePaiseSchema,
  lowPaise: positivePaiseSchema,
  closePaise: positivePaiseSchema,
  volume: z.number().int().nonnegative().safe()
}).refine(
  ({ openPaise, highPaise, lowPaise, closePaise }) =>
    highPaise >= lowPaise &&
    highPaise >= openPaise &&
    highPaise >= closePaise &&
    lowPaise <= openPaise &&
    lowPaise <= closePaise,
  { message: "Candle OHLC values are inconsistent" }
);

export const CandlesQuerySchema = z.object({
  interval: z.enum(["1m", "5m", "15m", "1h", "4h", "1d"]).default("1d"),
  limit: z.coerce.number().int().min(1).max(1000).default(100)
});
export const CandlesResponseSchema = z.object({
  candles: z.array(CandleSchema)
});

export const MarketInstrumentResponseSchema = z.object({
  instrument: InstrumentSchema,
  quote: QuoteSchema.nullable()
});

export const WatchlistSchema = z.object({
  id: z.uuid(),
  name: z.string().trim().min(1).max(80),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime()
});

export const WatchlistDetailSchema = WatchlistSchema.extend({
  instruments: z.array(z.object({
    symbol: symbolSchema,
    name: z.string().min(1),
    pricePaise: positivePaiseSchema
  }))
});

export const CreateWatchlistRequestSchema = z.object({
  name: z.string().trim().min(1).max(80)
});

export const UpdateWatchlistRequestSchema = CreateWatchlistRequestSchema;
export const WatchlistsResponseSchema = z.object({
  watchlists: z.array(WatchlistDetailSchema)
});

export const OrderSideSchema = z.enum(["buy", "sell"]);
export const OrderTypeSchema = z.enum(["market", "limit"]);
export const OrderStatusSchema = z.enum([
  "pending",
  "open",
  "partially_filled",
  "filled",
  "cancelled",
  "rejected"
]);

export type OrderStatus = z.infer<typeof OrderStatusSchema>;

export const OrderStatusTransitions = {
  pending: ["open", "cancelled", "rejected"],
  open: ["partially_filled", "filled", "cancelled", "rejected"],
  partially_filled: ["filled", "cancelled"],
  filled: [],
  cancelled: [],
  rejected: []
} as const satisfies Readonly<Record<OrderStatus, readonly OrderStatus[]>>;

export function canTransitionOrderStatus(from: OrderStatus, to: OrderStatus): boolean {
  return OrderStatusTransitions[from].some((status) => status === to);
}

export const OrderRequestSchema = z.discriminatedUnion("type", [
  z.object({
    symbol: symbolSchema,
    side: OrderSideSchema,
    type: z.literal("market"),
    quantity: quantitySchema,
    idempotencyKey: z.string().trim().min(1).max(128).optional()
  }),
  z.object({
    symbol: symbolSchema,
    side: OrderSideSchema,
    type: z.literal("limit"),
    quantity: quantitySchema,
    limitPricePaise: positivePaiseSchema,
    idempotencyKey: z.string().trim().min(1).max(128).optional()
  })
]);

export const PlaceOrderRequestSchema = z.object({
  symbol: z.string().regex(/^[A-Z][A-Z0-9.-]{0,11}$/),
  side: OrderSideSchema,
  quantity: quantitySchema
});

export const OrderSchema = z.object({
  id: z.uuid(),
  symbol: z.string(),
  side: OrderSideSchema,
  quantity: quantitySchema,
  pricePaise: paiseSchema,
  totalPaise: paiseSchema,
  status: OrderStatusSchema,
  createdAt: z.iso.datetime()
});

export const OrderResponseSchema = z.object({
  id: z.uuid(),
  accountId: z.uuid(),
  instrumentId: z.uuid(),
  symbol: symbolSchema,
  side: OrderSideSchema,
  type: OrderTypeSchema,
  quantity: quantitySchema,
  limitPricePaise: positivePaiseSchema.nullable(),
  filledQuantity: z.number().int().nonnegative().safe(),
  status: OrderStatusSchema,
  idempotencyKey: z.string().max(128).nullable(),
  createdAt: z.iso.datetime()
});

export const OrdersResponseSchema = z.object({
  orders: z.array(OrderSchema)
});

export const PlaceOrderResponseSchema = z.object({
  order: OrderSchema
});

export const BalanceResponseSchema = z.object({
  balancePaise: paiseSchema
});

export const PositionSchema = z.object({
  symbol: z.string(),
  quantity: z.number().int().positive().safe(),
  averageCostPaise: paiseSchema,
  marketValuePaise: paiseSchema,
  profitLossPaise: z.number().int().safe()
});

export const PortfolioPositionSchema = z.object({
  accountId: z.uuid(),
  instrumentId: z.uuid(),
  symbol: symbolSchema,
  quantity: quantitySchema,
  averageCostPaise: paiseSchema
});

export const PortfolioResponseSchema = z.object({
  balancePaise: paiseSchema,
  positions: z.array(PositionSchema)
});

export const PortfolioSchema = z.object({
  accountId: z.uuid(),
  cashBalancePaise: paiseSchema,
  reservedBalancePaise: paiseSchema,
  positions: z.array(PortfolioPositionSchema)
});

export const AccountHoldingSchema = z.object({
  instrumentId: z.uuid(),
  symbol: symbolSchema,
  quantity: quantitySchema,
  averageCostPaise: paiseSchema,
  marketPricePaise: positivePaiseSchema,
  marketValuePaise: paiseSchema,
  unrealizedPnlPaise: z.number().int().safe()
});

export const AccountPortfolioResponseSchema = z.object({
  accountId: z.uuid(),
  cashBalancePaise: paiseSchema,
  reservedBalancePaise: paiseSchema,
  holdings: z.array(AccountHoldingSchema),
  totalEquityPaise: paiseSchema
});

export const EquityCurvePointSchema = z.object({
  timestamp: z.iso.datetime(),
  equityPaise: paiseSchema
});

export const HoldingContributionSchema = z.object({
  symbol: symbolSchema,
  dayChangeContributionPaise: z.number().int().safe()
});

export const PortfolioPerformanceResponseSchema = z.object({
  realizedPnlPaise: z.number().int().safe(),
  unrealizedPnlPaise: z.number().int().safe(),
  dayChangePaise: z.number().int().safe(),
  holdingContributions: z.array(HoldingContributionSchema),
  equityCurve: z.array(EquityCurvePointSchema)
});

export const FillSchema = z.object({
  id: z.uuid(),
  orderId: z.uuid(),
  counterOrderId: z.uuid().nullable(),
  pricePaise: positivePaiseSchema,
  quantity: quantitySchema,
  feePaise: paiseSchema,
  executedAt: z.iso.datetime()
});

export const LedgerEntryTypeSchema = z.enum([
  "deposit",
  "withdrawal",
  "reserve",
  "release",
  "trade_debit",
  "trade_credit",
  "fee"
]);

export const LedgerEntrySchema = z.object({
  id: z.uuid(),
  accountId: z.uuid(),
  fillId: z.uuid().nullable(),
  entryType: LedgerEntryTypeSchema,
  amountPaise: z.number().int().safe().refine((value) => value !== 0),
  balanceAfterPaise: paiseSchema,
  createdAt: z.iso.datetime()
});

export const PaginatedLedgerResponseSchema = z.object({
  entries: z.array(LedgerEntrySchema),
  pagination: z.object({
    limit: z.number().int().positive(),
    offset: z.number().int().nonnegative(),
    total: z.number().int().nonnegative()
  })
});

export const RiskRulesSchema = z.object({
  accountId: z.uuid(),
  maxOrderNotionalPaise: positivePaiseSchema,
  maxConcentrationPct: z.number().positive().max(100).multipleOf(0.01),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime()
});

export const RiskAlertSchema = z.object({
  id: z.uuid(),
  accountId: z.uuid(),
  ruleId: z.uuid().nullable(),
  orderId: z.uuid().nullable(),
  alertType: z.string().trim().min(1).max(64),
  severity: z.enum(["info", "warning", "critical"]),
  message: z.string().min(1),
  details: z.record(z.string(), z.unknown()),
  acknowledgedAt: z.iso.datetime().nullable(),
  createdAt: z.iso.datetime()
});

export const DomainEventSchema = z.object({
  id: z.uuid(),
  aggregateType: z.string().trim().min(1).max(64),
  aggregateId: z.uuid(),
  eventType: z.string().trim().min(1).max(128),
  sequenceNumber: z.number().int().positive().safe(),
  payload: z.record(z.string(), z.unknown()),
  requestId: z.uuid().nullable(),
  createdAt: z.iso.datetime()
});

export const ProfileResponseSchema = z.object({
  user: UserSchema,
  avatarUrl: z.url().nullable()
});

export const AvatarResponseSchema = z.object({
  avatarUrl: z.url()
});

export const AvatarFileMetadataSchema = z.object({
  mimeType: z.enum(["image/jpeg", "image/png", "image/webp"]),
  size: z.number().int().positive().max(2 * 1024 * 1024)
});

// SYLLABUS: validation
export const TradeQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(50),
  offset: z.coerce.number().int().min(0).max(1_000_000).default(0)
});

export const PaginationQuerySchema = TradeQuerySchema;

export const OrdersQuerySchema = TradeQuerySchema.extend({
  symbol: symbolSchema.optional(),
  side: OrderSideSchema.optional(),
  status: OrderStatusSchema.optional()
});

export const PaginatedOrdersResponseSchema = z.object({
  orders: z.array(OrderResponseSchema),
  pagination: z.object({
    limit: z.number().int().positive(),
    offset: z.number().int().nonnegative(),
    total: z.number().int().nonnegative()
  })
});

export const TradeSchema = z.object({
  id: z.uuid(),
  symbol: z.string(),
  side: z.enum(["buy", "sell"]),
  quantity: z.number().int().positive().safe(),
  pricePaise: paiseSchema,
  totalPaise: paiseSchema,
  createdAt: z.iso.datetime()
});

export const TradesResponseSchema = z.object({
  trades: z.array(TradeSchema)
});

export const ErrorResponseSchema = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    details: z.unknown().optional()
  })
});

export type HealthResponse = z.infer<typeof HealthResponseSchema>;
export type RegisterRequest = z.infer<typeof RegisterRequestSchema>;
export type LoginRequest = z.infer<typeof LoginRequestSchema>;
export type User = z.infer<typeof UserSchema>;
export type AdminUser = z.infer<typeof AdminUserSchema>;
export type AdminUsersResponse = z.infer<typeof AdminUsersResponseSchema>;
export type AuthResponse = z.infer<typeof AuthResponseSchema>;
export type InstrumentRecord = z.infer<typeof InstrumentSchema>;
export type Instrument = z.infer<typeof QuoteSchema>;
export type Quote = z.infer<typeof QuoteSchema>;
export type QuotesResponse = z.infer<typeof QuotesResponseSchema>;
export type Candle = z.infer<typeof CandleSchema>;
export type CandlesQuery = z.infer<typeof CandlesQuerySchema>;
export type CandlesResponse = z.infer<typeof CandlesResponseSchema>;
export type MarketInstrumentResponse = z.infer<typeof MarketInstrumentResponseSchema>;
export type Watchlist = z.infer<typeof WatchlistSchema>;
export type WatchlistDetail = z.infer<typeof WatchlistDetailSchema>;
export type CreateWatchlistRequest = z.infer<typeof CreateWatchlistRequestSchema>;
export type WatchlistsResponse = z.infer<typeof WatchlistsResponseSchema>;
export type OrderSide = z.infer<typeof OrderSideSchema>;
export type OrderType = z.infer<typeof OrderTypeSchema>;
export type OrderRequest = z.infer<typeof OrderRequestSchema>;
export type PlaceOrderRequest = z.infer<typeof PlaceOrderRequestSchema>;
export type Order = z.infer<typeof OrderSchema>;
export type OrderResponse = z.infer<typeof OrderResponseSchema>;
export type OrdersResponse = z.infer<typeof OrdersResponseSchema>;
export type PlaceOrderResponse = z.infer<typeof PlaceOrderResponseSchema>;
export type BalanceResponse = z.infer<typeof BalanceResponseSchema>;
export type Position = z.infer<typeof PositionSchema>;
export type PortfolioPosition = z.infer<typeof PortfolioPositionSchema>;
export type PortfolioResponse = z.infer<typeof PortfolioResponseSchema>;
export type Portfolio = z.infer<typeof PortfolioSchema>;
export type AccountHolding = z.infer<typeof AccountHoldingSchema>;
export type AccountPortfolioResponse = z.infer<typeof AccountPortfolioResponseSchema>;
export type EquityCurvePoint = z.infer<typeof EquityCurvePointSchema>;
export type HoldingContribution = z.infer<typeof HoldingContributionSchema>;
export type PortfolioPerformanceResponse = z.infer<typeof PortfolioPerformanceResponseSchema>;
export type Fill = z.infer<typeof FillSchema>;
export type LedgerEntryType = z.infer<typeof LedgerEntryTypeSchema>;
export type LedgerEntry = z.infer<typeof LedgerEntrySchema>;
export type PaginatedLedgerResponse = z.infer<typeof PaginatedLedgerResponseSchema>;
export type RiskRules = z.infer<typeof RiskRulesSchema>;
export type RiskAlert = z.infer<typeof RiskAlertSchema>;
export type DomainEvent = z.infer<typeof DomainEventSchema>;
export type ProfileResponse = z.infer<typeof ProfileResponseSchema>;
export type AvatarResponse = z.infer<typeof AvatarResponseSchema>;
export type AvatarFileMetadata = z.infer<typeof AvatarFileMetadataSchema>;
export type TradeQuery = z.infer<typeof TradeQuerySchema>;
export type OrdersQuery = z.infer<typeof OrdersQuerySchema>;
export type PaginatedOrdersResponse = z.infer<typeof PaginatedOrdersResponseSchema>;
export type PaginationQuery = z.infer<typeof PaginationQuerySchema>;
export type Trade = z.infer<typeof TradeSchema>;
export type TradesResponse = z.infer<typeof TradesResponseSchema>;
export type ErrorResponse = z.infer<typeof ErrorResponseSchema>;
