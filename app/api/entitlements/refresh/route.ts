import { env } from "cloudflare:workers";

import { getChatGPTUser } from "@/app/chatgpt-auth";
import { rejectCrossSiteMutation } from "@/lib/entitlements/request-security";
import { evaluatePremiumAccess } from "@/lib/entitlements/token-gate";
import { ensureMemberProfile } from "@/lib/entitlements/server";

export async function POST(request: Request) {
  const rejection = rejectCrossSiteMutation(request);
  if (rejection) return rejection;
  const contentLength = Number(request.headers.get("content-length") ?? 0);
  if (Number.isFinite(contentLength) && contentLength > 4_096) {
    return Response.json({ accepted: false, error: "request_too_large" }, { status: 413, headers: { "cache-control": "no-store" } });
  }
  const user = await getChatGPTUser();
  if (!user) return Response.json({ accepted: false, error: "sign_in_required" }, { status: 401, headers: { "cache-control": "no-store" } });
  await ensureMemberProfile(env.DB, user);
  try {
    const nowSeconds = Math.floor(Date.now() / 1_000);
    const recentCheck = await env.DB.prepare(`
      SELECT checked_at FROM token_gate_checks
      WHERE user_id = ? AND checked_at > ?
      ORDER BY checked_at DESC LIMIT 1
    `).bind(user.id, nowSeconds - 15).first<{ checked_at: number }>().catch(() => null);
    const gate = await evaluatePremiumAccess({
      db: env.DB,
      userId: user.id,
      bindings: env as unknown as Record<string, unknown>,
      force: !recentCheck,
      nowSeconds,
    });
    return Response.json({ accepted: true, premiumAccess: gate.access, tokenAdapter: gate.adapter }, {
      headers: { "cache-control": "no-store" },
    });
  } catch {
    return Response.json({ accepted: false, error: "holder_check_unavailable" }, {
      status: 503,
      headers: { "cache-control": "no-store" },
    });
  }
}
