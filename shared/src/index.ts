import { z } from "zod";

const paiseSchema = z.number().int().nonnegative().safe();
const positivePaiseSchema = z.number().int().positive().safe();
const symbolSchema = z.string().regex(/^[A-Z][A-Z0-9.-]{0,31}$/);
const quantitySchema = z.number().int().positive().safe();

export const HealthResponseSchema = z.object({
  status: z.literal("ok")
});

export const DatabaseHealthResponseSchema = z.object({
  status: z.enum(["ok", "error"]),
  database: z.string().min(1)
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

export const PaginationResponseSchema = z.object({
  limit: z.number().int().positive(),
  offset: z.number().int().nonnegative(),
  total: z.number().int().nonnegative()
});

export const AdminUsersResponseSchema = z.object({
  users: z.array(AdminUserSchema),
  pagination: PaginationResponseSchema
});

export const AdminRoleUpdateSchema = z.object({
  role: z.enum(["user", "admin"])
});

export const AdminInstrumentImportRowSchema = z.object({
  symbol: z.string().regex(/^[A-Z][A-Z0-9.-]{0,31}$/),
  name: z.string().trim().min(1).max(120),
  sector: z.string().trim().min(1).max(80),
  tickSizePaise: z.coerce.number().int().positive().safe(),
  lastPricePaise: z.coerce.number().int().positive().safe()
});

export const AdminInstrumentImportResponseSchema = z.object({
  imported: z.number().int().nonnegative().safe()
});

export const AdminAuditResponseSchema = z.object({
  events: z.array(z.object({
    id: z.uuid(),
    aggregateType: z.string(),
    aggregateId: z.uuid(),
    eventType: z.string(),
    sequenceNumber: z.number().int().positive().safe(),
    payload: z.record(z.string(), z.unknown()),
    requestId: z.uuid().nullable(),
    createdAt: z.iso.datetime()
  })),
  pagination: PaginationResponseSchema
});

export const AdminStatsResponseSchema = z.object({
  users: z.number().int().nonnegative().safe(),
  orders: z.number().int().nonnegative().safe(),
  volumePaise: paiseSchema,
  rejectedOrderPct: z.number().min(0).max(100)
});

export const SimulationControlsResponseSchema = z.object({
  marketMaker: z.object({ available: z.boolean(), running: z.boolean() }),
  ticker: z.object({ available: z.boolean(), running: z.boolean() })
});

export const SimulationControlRequestSchema = z.object({
  name: z.enum(["marketMaker", "ticker"]),
  running: z.boolean()
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

export const MarketInstrumentsResponseSchema = z.object({
  instruments: z.array(MarketInstrumentResponseSchema)
});

export const MarketDepthLevelSchema = z.object({
  pricePaise: positivePaiseSchema,
  quantity: quantitySchema,
  orderCount: z.number().int().positive().safe()
});

export const MarketDepthResponseSchema = z.object({
  bids: z.array(MarketDepthLevelSchema),
  asks: z.array(MarketDepthLevelSchema)
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

export const PortfolioInsightMetricsSchema = z.object({
  totalEquityPaise: paiseSchema,
  cashBalancePaise: paiseSchema,
  contributedCapitalPaise: paiseSchema,
  returnPct: z.number().nullable(),
  realizedPnlPaise: z.number().int().safe(),
  unrealizedPnlPaise: z.number().int().safe(),
  dayChangePaise: z.number().int().safe(),
  holdings: z.array(z.object({
    symbol: symbolSchema,
    marketValuePaise: paiseSchema,
    unrealizedPnlPaise: z.number().int().safe(),
    dayChangeContributionPaise: z.number().int().safe()
  }))
});

export const AiExplainResponseSchema = z.object({
  source: z.enum(["ollama", "template"]),
  explanation: z.string().min(1).max(1200),
  highlights: z.array(z.string().min(1).max(240)).max(5),
  metrics: PortfolioInsightMetricsSchema,
  generatedAt: z.iso.datetime()
});

export const LeagueEntrySchema = z.object({
  rank: z.number().int().positive().safe(),
  displayName: z.string().min(1).max(60),
  currentEquityPaise: paiseSchema,
  returnPct: z.number(),
  maxDrawdownPct: z.number().min(0).max(100),
  riskAdjustedScore: z.number(),
  updatedAt: z.iso.datetime()
});

export const LeagueResponseSchema = z.object({
  entries: z.array(LeagueEntrySchema),
  pagination: PaginationResponseSchema
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
  "virtual_reset",
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
  amountPaise: z.number().int().safe(),
  balanceAfterPaise: paiseSchema,
  createdAt: z.iso.datetime()
}).refine(({ entryType, amountPaise }) => entryType === "virtual_reset" || amountPaise !== 0, {
  message: "Ledger amount must be nonzero unless it records a virtual account reset",
  path: ["amountPaise"]
});

export const PaginatedLedgerResponseSchema = z.object({
  entries: z.array(LedgerEntrySchema),
  pagination: z.object({
    limit: z.number().int().positive(),
    offset: z.number().int().nonnegative(),
    total: z.number().int().nonnegative()
  })
});

export const RiskRulesInputSchema = z.object({
  maxOrderNotionalPaise: positivePaiseSchema,
  maxSingleStockConcentrationPct: z.number().positive().max(100).multipleOf(0.01),
  maxSectorConcentrationPct: z.number().positive().max(100).multipleOf(0.01)
});

export const RiskRulesSchema = RiskRulesInputSchema.extend({
  accountId: z.uuid(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime()
});

export const RiskPreviewRequestSchema = z.object({
  symbol: symbolSchema,
  side: OrderSideSchema,
  quantity: quantitySchema
});

export const RiskPreviewResponseSchema = z.object({
  symbol: symbolSchema,
  sector: z.string().trim().min(1),
  side: OrderSideSchema,
  quantity: quantitySchema,
  pricePaise: positivePaiseSchema,
  orderNotionalPaise: positivePaiseSchema,
  totalEquityPaise: paiseSchema,
  currentStockPct: z.number().nonnegative(),
  projectedStockPct: z.number().nonnegative(),
  currentSectorPct: z.number().nonnegative(),
  projectedSectorPct: z.number().nonnegative(),
  rejection: z.string().min(1).nullable()
});

export const RiskAlertReadRequestSchema = z.object({
  acknowledged: z.boolean()
});

export const RiskConcentrationSchema = z.object({
  name: z.string().trim().min(1),
  marketValuePaise: paiseSchema,
  concentrationPct: z.number().nonnegative().max(100)
});

export const RiskSummarySchema = z.object({
  accountId: z.uuid(),
  totalEquityPaise: paiseSchema,
  singleStocks: z.array(RiskConcentrationSchema.extend({
    name: symbolSchema,
    sector: z.string().trim().min(1)
  })),
  sectors: z.array(RiskConcentrationSchema),
  warnings: z.array(z.string())
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

export const RiskAlertsResponseSchema = z.object({
  alerts: z.array(RiskAlertSchema),
  pagination: z.object({
    limit: z.number().int().positive(),
    offset: z.number().int().nonnegative(),
    total: z.number().int().nonnegative()
  })
});

export const OrderTimelineEventSchema = z.object({
  id: z.uuid(),
  eventType: z.string().min(1),
  sequenceNumber: z.number().int().positive().safe(),
  message: z.string().min(1),
  payload: z.record(z.string(), z.unknown()),
  createdAt: z.iso.datetime()
});

export const OrderTimelineResponseSchema = z.object({
  orderId: z.uuid(),
  events: z.array(OrderTimelineEventSchema)
});

export const OrderReplayFrameSchema = z.object({
  eventId: z.uuid(),
  eventType: z.string().min(1),
  message: z.string().min(1),
  createdAt: z.iso.datetime(),
  cashBalancePaise: paiseSchema,
  holdings: z.array(z.object({
    symbol: symbolSchema,
    quantity: z.number().int().nonnegative().safe(),
    averageCostPaise: paiseSchema
  }))
});

export const OrderReplayResponseSchema = z.object({
  orderId: z.uuid(),
  frames: z.array(OrderReplayFrameSchema)
});

export const PortfolioDifferenceSchema = z.object({
  field: z.string().min(1),
  live: z.unknown(),
  rebuilt: z.unknown()
});

export const PortfolioVerifyResponseSchema = z.object({
  match: z.boolean(),
  differences: z.array(PortfolioDifferenceSchema)
});

export const WebSocketChannelSchema = z.enum(["quotes", "orders", "portfolio"]);

export const WebSocketClientMessageSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("subscribe"),
    channels: z.array(WebSocketChannelSchema).min(1)
  })
]);

export const WebSocketServerMessageSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("ready"), userId: z.uuid() }),
  z.object({
    type: z.literal("subscribed"),
    channels: z.array(WebSocketChannelSchema)
  }),
  z.object({
    type: z.literal("quote"),
    data: QuoteSchema
  }),
  z.object({
    type: z.literal("order.update"),
    data: z.object({
      id: z.uuid(),
      aggregateId: z.uuid(),
      eventType: z.string().min(1),
      payload: z.record(z.string(), z.unknown())
    })
  }),
  z.object({
    type: z.literal("portfolio.update"),
    data: z.object({
      accountId: z.uuid(),
      fillId: z.uuid(),
      symbol: symbolSchema,
      side: OrderSideSchema,
      quantity: quantitySchema,
      pricePaise: positivePaiseSchema,
      feePaise: paiseSchema
    })
  }),
  z.object({
    type: z.literal("error"),
    code: z.string().min(1),
    message: z.string().min(1)
  })
]);

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

export const ProfileDetailsResponseSchema = ProfileResponseSchema.extend({
  createdAt: z.iso.datetime(),
  resetCooldownHours: z.number().int().positive(),
  lastResetAt: z.iso.datetime().nullable(),
  nextResetAt: z.iso.datetime().nullable()
});

export const UpdateProfileRequestSchema = z.object({
  displayName: z.string().trim().min(2).max(60)
});

export const ChangePasswordRequestSchema = z.object({
  currentPassword: z.string().min(1).refine((value) => new TextEncoder().encode(value).byteLength <= 72, {
    message: "Password must be no more than 72 UTF-8 bytes"
  }),
  newPassword: z.string().min(12).refine((value) => new TextEncoder().encode(value).byteLength <= 72, {
    message: "Password must be no more than 72 UTF-8 bytes"
  })
});

export const ResetVirtualAccountResponseSchema = z.object({
  cashBalancePaise: paiseSchema,
  cancelledOrders: z.number().int().nonnegative().safe(),
  clearedPositions: z.number().int().nonnegative().safe(),
  nextResetAt: z.iso.datetime()
});

export const ResetVirtualAccountRequestSchema = z.object({
  confirm: z.literal("RESET")
});

export const VirtualResetCooldownSchema = z.object({
  cooldownHours: z.number().int().positive().max(8760)
});

export const VirtualResetCooldownResponseSchema = VirtualResetCooldownSchema.extend({
  updatedAt: z.iso.datetime()
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

export const AdminAuditQuerySchema = z.object({
  ...TradeQuerySchema.shape,
  aggregateType: z.string().trim().min(1).max(64).optional(),
  aggregateId: z.uuid().optional(),
  eventType: z.string().trim().min(1).max(128).optional(),
  requestId: z.uuid().optional()
});

export const OrdersQuerySchema = TradeQuerySchema.extend({
  symbol: symbolSchema.optional(),
  side: OrderSideSchema.optional(),
  status: OrderStatusSchema.optional(),
  date: z.iso.date().optional()
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
export type AdminRoleUpdate = z.infer<typeof AdminRoleUpdateSchema>;
export type AdminInstrumentImportRow = z.infer<typeof AdminInstrumentImportRowSchema>;
export type AdminInstrumentImportResponse = z.infer<typeof AdminInstrumentImportResponseSchema>;
export type AdminAuditQuery = z.infer<typeof AdminAuditQuerySchema>;
export type AdminAuditResponse = z.infer<typeof AdminAuditResponseSchema>;
export type AdminStatsResponse = z.infer<typeof AdminStatsResponseSchema>;
export type SimulationControlsResponse = z.infer<typeof SimulationControlsResponseSchema>;
export type SimulationControlRequest = z.infer<typeof SimulationControlRequestSchema>;
export type AuthResponse = z.infer<typeof AuthResponseSchema>;
export type InstrumentRecord = z.infer<typeof InstrumentSchema>;
export type Instrument = z.infer<typeof QuoteSchema>;
export type Quote = z.infer<typeof QuoteSchema>;
export type QuotesResponse = z.infer<typeof QuotesResponseSchema>;
export type Candle = z.infer<typeof CandleSchema>;
export type CandlesQuery = z.infer<typeof CandlesQuerySchema>;
export type CandlesResponse = z.infer<typeof CandlesResponseSchema>;
export type MarketInstrumentResponse = z.infer<typeof MarketInstrumentResponseSchema>;
export type MarketInstrumentsResponse = z.infer<typeof MarketInstrumentsResponseSchema>;
export type MarketDepthResponse = z.infer<typeof MarketDepthResponseSchema>;
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
export type PortfolioInsightMetrics = z.infer<typeof PortfolioInsightMetricsSchema>;
export type AiExplainResponse = z.infer<typeof AiExplainResponseSchema>;
export type LeagueEntry = z.infer<typeof LeagueEntrySchema>;
export type LeagueResponse = z.infer<typeof LeagueResponseSchema>;
export type Fill = z.infer<typeof FillSchema>;
export type LedgerEntryType = z.infer<typeof LedgerEntryTypeSchema>;
export type LedgerEntry = z.infer<typeof LedgerEntrySchema>;
export type PaginatedLedgerResponse = z.infer<typeof PaginatedLedgerResponseSchema>;
export type RiskRules = z.infer<typeof RiskRulesSchema>;
export type RiskRulesInput = z.infer<typeof RiskRulesInputSchema>;
export type RiskPreviewRequest = z.infer<typeof RiskPreviewRequestSchema>;
export type RiskPreviewResponse = z.infer<typeof RiskPreviewResponseSchema>;
export type RiskAlertReadRequest = z.infer<typeof RiskAlertReadRequestSchema>;
export type RiskSummary = z.infer<typeof RiskSummarySchema>;
export type RiskAlert = z.infer<typeof RiskAlertSchema>;
export type RiskAlertsResponse = z.infer<typeof RiskAlertsResponseSchema>;
export type OrderTimelineEvent = z.infer<typeof OrderTimelineEventSchema>;
export type OrderTimelineResponse = z.infer<typeof OrderTimelineResponseSchema>;
export type OrderReplayFrame = z.infer<typeof OrderReplayFrameSchema>;
export type OrderReplayResponse = z.infer<typeof OrderReplayResponseSchema>;
export type PortfolioVerifyResponse = z.infer<typeof PortfolioVerifyResponseSchema>;
export type WebSocketChannel = z.infer<typeof WebSocketChannelSchema>;
export type WebSocketClientMessage = z.infer<typeof WebSocketClientMessageSchema>;
export type WebSocketServerMessage = z.infer<typeof WebSocketServerMessageSchema>;
export type DomainEvent = z.infer<typeof DomainEventSchema>;
export type ProfileResponse = z.infer<typeof ProfileResponseSchema>;
export type ProfileDetailsResponse = z.infer<typeof ProfileDetailsResponseSchema>;
export type UpdateProfileRequest = z.infer<typeof UpdateProfileRequestSchema>;
export type ChangePasswordRequest = z.infer<typeof ChangePasswordRequestSchema>;
export type ResetVirtualAccountResponse = z.infer<typeof ResetVirtualAccountResponseSchema>;
export type ResetVirtualAccountRequest = z.infer<typeof ResetVirtualAccountRequestSchema>;
export type VirtualResetCooldown = z.infer<typeof VirtualResetCooldownSchema>;
export type VirtualResetCooldownResponse = z.infer<typeof VirtualResetCooldownResponseSchema>;
export type AvatarResponse = z.infer<typeof AvatarResponseSchema>;
export type AvatarFileMetadata = z.infer<typeof AvatarFileMetadataSchema>;
export type TradeQuery = z.infer<typeof TradeQuerySchema>;
export type OrdersQuery = z.infer<typeof OrdersQuerySchema>;
export type PaginatedOrdersResponse = z.infer<typeof PaginatedOrdersResponseSchema>;
export type PaginationQuery = z.infer<typeof PaginationQuerySchema>;
export type PaginationResponse = z.infer<typeof PaginationResponseSchema>;
export type Trade = z.infer<typeof TradeSchema>;
export type TradesResponse = z.infer<typeof TradesResponseSchema>;
export type ErrorResponse = z.infer<typeof ErrorResponseSchema>;
