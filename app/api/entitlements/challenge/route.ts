import { env } from "cloudflare:workers";
import { getAddress } from "viem";

import { getChatGPTUser } from "@/app/chatgpt-auth";
import { ensureMemberProfile } from "@/lib/entitlements/server";
import { rejectCrossSiteMutation } from "@/lib/entitlements/request-security";
import { buildWalletLinkMessage, walletChallengeExpiry } from "@/lib/entitlements/wallet-message";

export async function POST(request: Request) {
  const rejection = rejectCrossSiteMutation(request);
  if (rejection) return rejection;
  const contentLength = Number(request.headers.get("content-length") ?? 0);
  if (Number.isFinite(contentLength) && contentLength > 8_192) {
    return Response.json({ accepted: false, error: "request_too_large" }, { status: 413, headers: { "cache-control": "no-store" } });
  }
  const user = await getChatGPTUser();
  if (!user) return Response.json({ accepted: false, error: "sign_in_required" }, { status: 401, headers: { "cache-control": "no-store" } });

  let rawAddress = "";
  try {
    const payload = await request.json() as Record<string, unknown>;
    rawAddress = typeof payload.address === "string" ? payload.address.trim() : "";
  } catch {
    return Response.json({ accepted: false, error: "invalid_request" }, { status: 400, headers: { "cache-control": "no-store" } });
  }

  let address: `0x${string}`;
  try {
    address = getAddress(rawAddress);
  } catch {
    return Response.json({ accepted: false, error: "invalid_wallet_address" }, { status: 422, headers: { "cache-control": "no-store" } });
  }

  await ensureMemberProfile(env.DB, user);
  const id = crypto.randomUUID();
  const issuedAt = Math.floor(Date.now() / 1_000);
  const recent = await env.DB.prepare(`
    SELECT COUNT(*) AS count
    FROM wallet_link_challenges
    WHERE user_id = ? AND created_at > ?
  `).bind(user.id, issuedAt - 60).first<{ count: number }>();
  if (Number(recent?.count ?? 0) >= 5) {
    return Response.json({ accepted: false, error: "challenge_rate_limited" }, { status: 429, headers: { "cache-control": "no-store" } });
  }
  await env.DB.prepare(`
    UPDATE wallet_link_challenges
    SET used_at = ?
    WHERE user_id = ? AND wallet_address = ? AND used_at IS NULL
  `).bind(issuedAt, user.id, address.toLowerCase()).run();
  const expiresAt = walletChallengeExpiry(issuedAt);
  const origin = new URL(request.url).origin;
  const message = buildWalletLinkMessage({
    accountId: user.id,
    walletAddress: address,
    challengeId: id,
    origin,
    issuedAt,
    expiresAt,
  });

  await env.DB.prepare(`
    INSERT INTO wallet_link_challenges
      (id, user_id, wallet_address, message, expires_at, used_at, created_at)
    VALUES (?, ?, ?, ?, ?, NULL, ?)
  `).bind(id, user.id, address.toLowerCase(), message, expiresAt, issuedAt).run();

  return Response.json({ accepted: true, challengeId: id, address, message, expiresAt }, {
    headers: { "cache-control": "no-store" },
  });
}
