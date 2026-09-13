import { env } from "cloudflare:workers";

import { chatGPTSignInPath } from "@/app/chatgpt-auth";
import {
  authErrorResponse,
  AuthRequestError,
  authProviderFromBindings,
} from "@/lib/auth/config";
import { authenticateMember } from "@/lib/auth/server";
import { readEntitlementProfile } from "@/lib/entitlements/server";
import { evaluatePremiumAccess } from "@/lib/entitlements/token-gate";

const PUBLIC_GUARANTEES = ["canonical events", "methodology", "integrity", "rankings"];

type WalletRow = {
  wallet_address: string;
  chain_id: number;
  is_primary: number;
  verified_at: number;
};

export async function GET(request: Request) {
  const bindings = env as unknown as Record<string, unknown>;
  let authProvider: ReturnType<typeof authProviderFromBindings>;
  try {
    authProvider = authProviderFromBindings(bindings);
  } catch (error) {
    return authErrorResponse(error);
  }

  let user: Awaited<ReturnType<typeof authenticateMember>>;
  try {
    user = await authenticateMember({
      request,
      db: env.DB,
      bindings,
      forceIdentitySync: new URL(request.url).searchParams.get("sync") === "1",
    });
  } catch (error) {
    if (error instanceof AuthRequestError) {
      return Response.json({
        authenticated: false,
        authProvider,
        signInPath: authProvider === "chatgpt"
          ? chatGPTSignInPath("/?view=network#passport")
          : null,
        error: error.code,
        publicGuarantees: PUBLIC_GUARANTEES,
      }, { status: error.status, headers: { "cache-control": "no-store" } });
    }
    return authErrorResponse(error);
  }

  if (!user) {
    return Response.json({
      authenticated: false,
      authProvider,
      signInPath: authProvider === "chatgpt"
        ? chatGPTSignInPath("/?view=network#passport")
        : null,
      publicGuarantees: PUBLIC_GUARANTEES,
    }, { headers: { "cache-control": "no-store" } });
  }

  const walletResult = await env.DB.prepare(`
    SELECT wallet_address, chain_id, is_primary, verified_at
    FROM linked_wallets
    WHERE user_id = ?
    ORDER BY is_primary DESC, verified_at ASC
  `).bind(user.id).all<WalletRow>();
  const gate = await evaluatePremiumAccess({
    db: env.DB,
    userId: user.id,
    bindings,
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
    authProvider: user.provider,
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
    publicGuarantees: PUBLIC_GUARANTEES,
  }, { headers: { "cache-control": "private, no-store" } });
}
