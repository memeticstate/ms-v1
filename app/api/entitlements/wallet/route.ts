import { env } from "cloudflare:workers";
import { verifyMessage } from "viem";

import { getChatGPTUser } from "@/app/chatgpt-auth";
import { rejectCrossSiteMutation } from "@/lib/entitlements/request-security";
import { ROBINHOOD_CHAIN_ID } from "@/lib/entitlements/wallet-message";
import { evaluatePremiumAccess } from "@/lib/entitlements/token-gate";

type ChallengeRow = {
  id: string;
  user_id: string;
  wallet_address: string;
  message: string;
  expires_at: number;
  used_at: number | null;
};

export async function POST(request: Request) {
  const rejection = rejectCrossSiteMutation(request);
  if (rejection) return rejection;
  const contentLength = Number(request.headers.get("content-length") ?? 0);
  if (Number.isFinite(contentLength) && contentLength > 20_000) {
    return Response.json({ accepted: false, error: "request_too_large" }, { status: 413, headers: { "cache-control": "no-store" } });
  }
  const user = await getChatGPTUser();
  if (!user) return Response.json({ accepted: false, error: "sign_in_required" }, { status: 401, headers: { "cache-control": "no-store" } });

  let challengeId = "";
  let signature = "";
  try {
    const payload = await request.json() as Record<string, unknown>;
    challengeId = typeof payload.challengeId === "string" ? payload.challengeId.trim() : "";
    signature = typeof payload.signature === "string" ? payload.signature.trim() : "";
  } catch {
    return Response.json({ accepted: false, error: "invalid_request" }, { status: 400, headers: { "cache-control": "no-store" } });
  }
  if (!challengeId || !/^0x[a-fA-F0-9]{130}$/.test(signature)) {
    return Response.json({ accepted: false, error: "invalid_signature_request" }, { status: 422, headers: { "cache-control": "no-store" } });
  }

  const challenge = await env.DB.prepare(`
    SELECT id, user_id, wallet_address, message, expires_at, used_at
    FROM wallet_link_challenges
    WHERE id = ? AND user_id = ?
    LIMIT 1
  `).bind(challengeId, user.id).first<ChallengeRow>();
  const now = Math.floor(Date.now() / 1_000);
  if (!challenge || challenge.used_at !== null || challenge.expires_at <= now) {
    return Response.json({ accepted: false, error: "challenge_expired_or_used" }, { status: 409, headers: { "cache-control": "no-store" } });
  }

  const verified = await verifyMessage({
    address: challenge.wallet_address as `0x${string}`,
    message: challenge.message,
    signature: signature as `0x${string}`,
  }).catch(() => false);
  if (!verified) return Response.json({ accepted: false, error: "signature_mismatch" }, { status: 422, headers: { "cache-control": "no-store" } });

  const consumed = await env.DB.prepare(`
    UPDATE wallet_link_challenges
    SET used_at = ?
    WHERE id = ? AND user_id = ? AND used_at IS NULL AND expires_at > ?
  `).bind(now, challenge.id, user.id, now).run();
  if ((consumed.meta?.changes ?? 0) !== 1) {
    return Response.json({ accepted: false, error: "challenge_already_used" }, { status: 409, headers: { "cache-control": "no-store" } });
  }

  const existing = await env.DB.prepare(`
    SELECT user_id FROM linked_wallets WHERE wallet_address = ? LIMIT 1
  `).bind(challenge.wallet_address).first<{ user_id: string }>();
  if (existing && existing.user_id !== user.id) {
    return Response.json({ accepted: false, error: "wallet_already_linked" }, { status: 409, headers: { "cache-control": "no-store" } });
  }

  const linked = await env.DB.prepare(`
    INSERT INTO linked_wallets
      (wallet_address, user_id, chain_id, is_primary, verified_at, updated_at)
    VALUES (?, ?, ?, 1, ?, ?)
    ON CONFLICT(wallet_address) DO UPDATE SET
      chain_id = excluded.chain_id,
      is_primary = 1,
      verified_at = excluded.verified_at,
      updated_at = excluded.updated_at
    WHERE linked_wallets.user_id = excluded.user_id
  `).bind(challenge.wallet_address, user.id, ROBINHOOD_CHAIN_ID, now, now).run();
  if ((linked.meta?.changes ?? 0) !== 1) {
    return Response.json({ accepted: false, error: "wallet_already_linked" }, { status: 409, headers: { "cache-control": "no-store" } });
  }
  await env.DB.prepare(`
    UPDATE linked_wallets SET is_primary = 0, updated_at = ?
    WHERE user_id = ? AND wallet_address != ?
  `).bind(now, user.id, challenge.wallet_address).run();

  let gate: Awaited<ReturnType<typeof evaluatePremiumAccess>> | null = null;
  try {
    gate = await evaluatePremiumAccess({
      db: env.DB,
      userId: user.id,
      bindings: env as unknown as Record<string, unknown>,
      force: true,
    });
  } catch {
    // Wallet linking remains useful even if the external holder check is temporarily unavailable.
  }

  return Response.json({
    accepted: true,
    address: challenge.wallet_address,
    chainId: ROBINHOOD_CHAIN_ID,
    ...(gate ? { premiumAccess: gate.access, tokenAdapter: gate.adapter } : {}),
  }, {
    headers: { "cache-control": "no-store" },
  });
}
