import { env } from "cloudflare:workers";

import { chatGPTSignInPath, getChatGPTUser } from "@/app/chatgpt-auth";
import { evaluatePremiumAccess } from "@/lib/entitlements/token-gate";
import { ensureMemberProfile, readEntitlementProfile } from "@/lib/entitlements/server";

type WalletRow = {
  wallet_address: string;
  chain_id: number;
  is_primary: number;
  verified_at: number;
};

export async function GET() {
  const user = await getChatGPTUser();
  if (!user) {
    return Response.json({
      authenticated: false,
      signInPath: chatGPTSignInPath("/?view=network#passport"),
      publicGuarantees: ["canonical events", "methodology", "integrity", "rankings"],
    }, { status: 401, headers: { "cache-control": "no-store" } });
  }

  await ensureMemberProfile(env.DB, user);
  const walletResult = await env.DB.prepare(`
    SELECT wallet_address, chain_id, is_primary, verified_at
    FROM linked_wallets
    WHERE user_id = ?
    ORDER BY is_primary DESC, verified_at DESC
  `).bind(user.id).all<WalletRow>();
  const gate = await evaluatePremiumAccess({
    db: env.DB,
    userId: user.id,
    bindings: env as unknown as Record<string, unknown>,
  });
  const [profile, watchRow] = await Promise.all([
    readEntitlementProfile(env.DB, user.id),
    env.DB.prepare(`
      SELECT COUNT(*) AS count FROM watchtower_watches WHERE user_id = ?
    `).bind(user.id).first<{ count: number }>(),
  ]);
  const watchCount = Number(watchRow?.count ?? 0);
  profile.used.server_watch_slots = watchCount;
  profile.remaining.server_watch_slots = Math.max(0, profile.allowances.server_watch_slots - watchCount);

  return Response.json({
    authenticated: true,
    account: {
      displayName: user.displayName,
      email: user.email,
    },
    wallets: (walletResult.results ?? []).map((wallet) => ({
      address: wallet.wallet_address,
      chainId: wallet.chain_id,
      primary: Boolean(wallet.is_primary),
      verifiedAt: new Date(wallet.verified_at * 1_000).toISOString(),
    })),
    entitlements: profile,
    tokenAdapter: gate.adapter,
    premiumAccess: gate.access,
    publicGuarantees: ["canonical events", "methodology", "integrity", "rankings"],
  }, { headers: { "cache-control": "no-store" } });
}
