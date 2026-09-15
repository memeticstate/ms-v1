import { env } from "cloudflare:workers";
import { watchAddressSchema as address, watchEntrySchema as watch } from "@/lib/pons/watch-schema";

import { authErrorResponse } from "@/lib/auth/config";
import { authenticateMember } from "@/lib/auth/server";
import { readEntitlementProfile } from "@/lib/entitlements/server";
import { rejectCrossSiteMutation } from "@/lib/entitlements/request-security";


async function authenticatedUser(request: Request) {
  return authenticateMember({
    request,
    db: env.DB,
    bindings: env as unknown as Record<string, unknown>,
  });
}

export async function GET(request: Request) {
  let user: Awaited<ReturnType<typeof authenticateMember>>;
  try {
    user = await authenticatedUser(request);
  } catch (error) {
    return authErrorResponse(error);
  }
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
  let user: Awaited<ReturnType<typeof authenticateMember>>;
  try {
    user = await authenticatedUser(request);
  } catch (error) {
    return authErrorResponse(error);
  }
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
  let user: Awaited<ReturnType<typeof authenticateMember>>;
  try {
    user = await authenticatedUser(request);
  } catch (error) {
    return authErrorResponse(error);
  }
  if (!user) return Response.json({ accepted: false, error: "sign_in_required" }, { status: 401, headers: { "cache-control": "no-store" } });
  const payload = await request.json().catch(() => null) as { tokenAddress?: unknown } | null;
  const parsedAddress = address.safeParse(payload?.tokenAddress);
  if (!parsedAddress.success) return Response.json({ accepted: false, error: "invalid_watch" }, { status: 422, headers: { "cache-control": "no-store" } });
  await env.DB.prepare(`
    DELETE FROM watchtower_watches WHERE user_id = ? AND token_address = ?
  `).bind(user.id, parsedAddress.data).run();
  return Response.json({ accepted: true }, { headers: { "cache-control": "no-store" } });
}
