import { z } from "zod";

const paiseSchema = z.number().int().nonnegative().safe();

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
  user: UserSchema
});

export const InstrumentSchema = z.object({
  symbol: z.string().regex(/^[A-Z][A-Z0-9.-]{0,11}$/),
  name: z.string().min(1),
  pricePaise: paiseSchema,
  changePaise: z.number().int().safe(),
  updatedAt: z.iso.datetime()
});

export const QuotesResponseSchema = z.object({
  quotes: z.array(InstrumentSchema)
});

export const PlaceOrderRequestSchema = z.object({
  symbol: z.string().regex(/^[A-Z][A-Z0-9.-]{0,11}$/),
  side: z.enum(["buy", "sell"]),
  quantity: z.number().int().positive().safe()
});

export const OrderSchema = z.object({
  id: z.uuid(),
  symbol: z.string(),
  side: z.enum(["buy", "sell"]),
  quantity: z.number().int().positive().safe(),
  pricePaise: paiseSchema,
  totalPaise: paiseSchema,
  status: z.literal("filled"),
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

export const PortfolioResponseSchema = z.object({
  balancePaise: paiseSchema,
  positions: z.array(PositionSchema)
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
    message: z.string()
  })
});

export type HealthResponse = z.infer<typeof HealthResponseSchema>;
export type RegisterRequest = z.infer<typeof RegisterRequestSchema>;
export type LoginRequest = z.infer<typeof LoginRequestSchema>;
export type User = z.infer<typeof UserSchema>;
export type AdminUser = z.infer<typeof AdminUserSchema>;
export type AdminUsersResponse = z.infer<typeof AdminUsersResponseSchema>;
export type AuthResponse = z.infer<typeof AuthResponseSchema>;
export type Instrument = z.infer<typeof InstrumentSchema>;
export type QuotesResponse = z.infer<typeof QuotesResponseSchema>;
export type PlaceOrderRequest = z.infer<typeof PlaceOrderRequestSchema>;
export type Order = z.infer<typeof OrderSchema>;
export type OrdersResponse = z.infer<typeof OrdersResponseSchema>;
export type PlaceOrderResponse = z.infer<typeof PlaceOrderResponseSchema>;
export type BalanceResponse = z.infer<typeof BalanceResponseSchema>;
export type Position = z.infer<typeof PositionSchema>;
export type PortfolioResponse = z.infer<typeof PortfolioResponseSchema>;
export type ProfileResponse = z.infer<typeof ProfileResponseSchema>;
export type AvatarResponse = z.infer<typeof AvatarResponseSchema>;
export type AvatarFileMetadata = z.infer<typeof AvatarFileMetadataSchema>;
export type TradeQuery = z.infer<typeof TradeQuerySchema>;
export type Trade = z.infer<typeof TradeSchema>;
export type TradesResponse = z.infer<typeof TradesResponseSchema>;
export type ErrorResponse = z.infer<typeof ErrorResponseSchema>;
