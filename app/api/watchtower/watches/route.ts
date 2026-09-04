import { env } from "cloudflare:workers";
import { z } from "zod";

import { getChatGPTUser } from "@/app/chatgpt-auth";
import { ensureMemberProfile, readEntitlementProfile } from "@/lib/entitlements/server";
import { rejectCrossSiteMutation } from "@/lib/entitlements/request-security";

const address = z.string().regex(/^0x[a-fA-F0-9]{40}$/).transform((value) => value.toLowerCase());
const rules = z.object({
  signalChange: z.boolean(),
  lifecycleChange: z.boolean(),
  activityThreshold: z.number().int().min(0).max(1_000_000).nullable(),
  momentumThreshold: z.number().int().min(-10_000).max(100_000).nullable(),
});
const watch = z.object({
  tokenAddress: address,
  name: z.string().trim().min(1).max(160),
  symbol: z.string().trim().min(1).max(40),
  pairSymbol: z.string().trim().min(1).max(40),
  pairColor: z.string().trim().min(1).max(80),
  savedAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  rules,
  lastSeen: z.object({
    signal: z.enum(["surging", "broadening", "forming", "steady", "cooling", "quiet"]),
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

async function authenticatedUser() {
  const user = await getChatGPTUser();
  if (user) await ensureMemberProfile(env.DB, user);
  return user;
}

export async function GET() {
  const user = await authenticatedUser();
  if (!user) return Response.json({ authenticated: false, watches: [] }, { status: 401 });
  const result = await env.DB.prepare(`
    SELECT payload_json FROM watchtower_watches
    WHERE user_id = ? ORDER BY updated_at DESC
  `).bind(user.id).all<{ payload_json: string }>();
  const watches = (result.results ?? []).flatMap((row) => {
    try {
      const parsed = watch.safeParse(JSON.parse(row.payload_json));
      return parsed.success ? [parsed.data] : [];
    } catch {
      return [];
    }
  });
  return Response.json({ authenticated: true, watches }, { headers: { "cache-control": "no-store" } });
}

export async function POST(request: Request) {
  const rejection = rejectCrossSiteMutation(request);
  if (rejection) return rejection;
  const contentLength = Number(request.headers.get("content-length") ?? 0);
  if (Number.isFinite(contentLength) && contentLength > 32_768) {
    return Response.json({ accepted: false, error: "request_too_large" }, { status: 413, headers: { "cache-control": "no-store" } });
  }
  const user = await authenticatedUser();
  if (!user) return Response.json({ accepted: false, error: "sign_in_required" }, { status: 401, headers: { "cache-control": "no-store" } });
  const parsed = watch.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ accepted: false, error: "invalid_watch" }, { status: 422, headers: { "cache-control": "no-store" } });

  const now = Math.floor(Date.now() / 1_000);
  const payload = { ...parsed.data, updatedAt: new Date(now * 1_000).toISOString() };
  const existing = await env.DB.prepare(`
    SELECT 1 AS found FROM watchtower_watches WHERE user_id = ? AND token_address = ? LIMIT 1
  `).bind(user.id, payload.tokenAddress).first<{ found: number }>();
  if (existing) {
    await env.DB.prepare(`
      UPDATE watchtower_watches SET payload_json = ?, updated_at = ?
      WHERE user_id = ? AND token_address = ?
    `).bind(JSON.stringify(payload), now, user.id, payload.tokenAddress).run();
    return Response.json({ accepted: true, synced: true, watch: payload }, { headers: { "cache-control": "no-store" } });
  }

  const profile = await readEntitlementProfile(env.DB, user.id, now);
  const inserted = await env.DB.prepare(`
    INSERT INTO watchtower_watches (user_id, token_address, payload_json, created_at, updated_at)
    SELECT ?, ?, ?, ?, ?
    WHERE (SELECT COUNT(*) FROM watchtower_watches WHERE user_id = ?) < ?
  `).bind(
    user.id, payload.tokenAddress, JSON.stringify(payload), now, now,
    user.id, profile.allowances.server_watch_slots,
  ).run();
  if ((inserted.meta?.changes ?? 0) !== 1) {
    return Response.json({ accepted: false, error: "watch_capacity_reached" }, { status: 409 });
  }
  return Response.json({ accepted: true, synced: true, watch: payload }, {
    status: 201,
    headers: { "cache-control": "no-store" },
  });
}

export async function DELETE(request: Request) {
  const rejection = rejectCrossSiteMutation(request);
  if (rejection) return rejection;
  const contentLength = Number(request.headers.get("content-length") ?? 0);
  if (Number.isFinite(contentLength) && contentLength > 4_096) {
    return Response.json({ accepted: false, error: "request_too_large" }, { status: 413, headers: { "cache-control": "no-store" } });
  }
  const user = await authenticatedUser();
  if (!user) return Response.json({ accepted: false, error: "sign_in_required" }, { status: 401, headers: { "cache-control": "no-store" } });
  const payload = await request.json().catch(() => null) as { tokenAddress?: unknown } | null;
  const parsedAddress = address.safeParse(payload?.tokenAddress);
  if (!parsedAddress.success) return Response.json({ accepted: false, error: "invalid_watch" }, { status: 422, headers: { "cache-control": "no-store" } });
  await env.DB.prepare(`
    DELETE FROM watchtower_watches WHERE user_id = ? AND token_address = ?
  `).bind(user.id, parsedAddress.data).run();
  return Response.json({ accepted: true }, { headers: { "cache-control": "no-store" } });
}
