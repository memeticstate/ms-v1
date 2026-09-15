import { z } from "zod";

export const watchAddressSchema = z.string().regex(/^0x[a-fA-F0-9]{40}$/).transform((value) => value.toLowerCase());
const rules = z.object({
  signalChange: z.boolean(),
  lifecycleChange: z.boolean(),
  activityThreshold: z.number().int().min(0).max(1_000_000).nullable(),
  momentumThreshold: z.number().int().min(-10_000).max(100_000).nullable(),
});
export const watchEntrySchema = z.object({
  tokenAddress: watchAddressSchema,
  name: z.string().trim().min(1).max(160),
  symbol: z.string().trim().min(1).max(40),
  pairSymbol: z.string().trim().min(1).max(40),
  pairColor: z.string().trim().min(1).max(80),
  savedAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  rules,
  lastSeen: z.object({
    signal: z.enum(["surging", "broadening", "forming", "steady", "cooling", "quiet", "historical", "unverified", "inactive", "stressed"]),
    phase: z.enum(["bonding", "graduated", "swept"]),
    recentTrades: z.number().int().min(0),
    momentumPercent: z.number().nullable(),
    attentionScore: z.number().min(0).max(100),
  }),
  alerts: z.array(z.object({
    id: z.string().max(240),
    kind: z.enum(["signal", "lifecycle", "activity", "momentum"]),
    title: z.string().max(240),
    detail: z.string().max(500),
    observedAt: z.string().datetime(),
    read: z.boolean(),
  })).max(20),
});
