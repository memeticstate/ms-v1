import { env } from "cloudflare:workers";

import { authErrorResponse } from "@/lib/auth/config";
import { authenticateMember, memberIsAdmin } from "@/lib/auth/server";

type MemberRow = {
  user_id: string;
  email: string;
  display_name: string;
  created_at: number;
  updated_at: number;
  last_authenticated_at: number | null;
  providers: string | null;
  identity_count: number;
  watch_count: number;
};

type WalletRow = {
  user_id: string;
  wallet_address: string;
  is_primary: number;
};

type GrantRow = {
  user_id: string;
  plan: string;
  source: string;
};

export async function GET(request: Request) {
  const bindings = env as unknown as Record<string, unknown>;
  let operator: Awaited<ReturnType<typeof authenticateMember>>;
  try {
    operator = await authenticateMember({
      request,
      db: env.DB,
      bindings,
      forceIdentitySync: true,
    });
  } catch (error) {
    return authErrorResponse(error);
  }
  if (!operator) {
    return Response.json({ error: "sign_in_required" }, {
      status: 401,
      headers: { "cache-control": "no-store" },
    });
  }
  if (!memberIsAdmin(operator, bindings)) {
    return Response.json({ error: "admin_access_required" }, {
      status: 403,
      headers: { "cache-control": "no-store" },
    });
  }

  const memberResult = await env.DB.prepare(`
    SELECT
      p.user_id,
      p.email,
      p.display_name,
      p.created_at,
      p.updated_at,
      MAX(i.last_authenticated_at) AS last_authenticated_at,
      GROUP_CONCAT(DISTINCT i.provider) AS providers,
      COUNT(DISTINCT i.provider || ':' || i.subject) AS identity_count,
      COUNT(DISTINCT w.token_address) AS watch_count
    FROM member_profiles p
    LEFT JOIN member_identities i ON i.user_id = p.user_id
    LEFT JOIN watchtower_watches w ON w.user_id = p.user_id
    GROUP BY p.user_id
    ORDER BY COALESCE(MAX(i.last_authenticated_at), p.updated_at) DESC
    LIMIT 250
  `).all<MemberRow>();
  const rows = memberResult.results ?? [];
  if (!rows.length) {
    return Response.json({ members: [], generatedAt: new Date().toISOString() }, {
      headers: { "cache-control": "private, no-store" },
    });
  }

  const placeholders = rows.map(() => "?").join(", ");
  const memberIds = rows.map((row) => row.user_id);
  const [walletResult, grantResult] = await Promise.all([
    env.DB.prepare(`
      SELECT user_id, wallet_address, is_primary
      FROM linked_wallets
      WHERE user_id IN (${placeholders})
      ORDER BY is_primary DESC, verified_at ASC
    `).bind(...memberIds).all<WalletRow>(),
    env.DB.prepare(`
      SELECT user_id, plan, source
      FROM entitlement_grants
      WHERE user_id IN (${placeholders})
        AND status = 'active'
        AND starts_at <= unixepoch()
        AND (ends_at IS NULL OR ends_at > unixepoch())
      ORDER BY starts_at DESC
    `).bind(...memberIds).all<GrantRow>(),
  ]);

  return Response.json({
    generatedAt: new Date().toISOString(),
    members: rows.map((row) => ({
      memberId: row.user_id,
      displayName: row.display_name,
      email: row.email || null,
      providers: row.providers?.split(",").filter(Boolean) ?? [],
      identityCount: Number(row.identity_count ?? 0),
      watchCount: Number(row.watch_count ?? 0),
      wallets: (walletResult.results ?? [])
        .filter((wallet) => wallet.user_id === row.user_id)
        .map((wallet) => ({ address: wallet.wallet_address, primary: Boolean(wallet.is_primary) })),
      grants: (grantResult.results ?? [])
        .filter((grant) => grant.user_id === row.user_id)
        .map(({ plan, source }) => ({ plan, source })),
      createdAt: new Date(row.created_at * 1_000).toISOString(),
      updatedAt: new Date(row.updated_at * 1_000).toISOString(),
      lastAuthenticatedAt: row.last_authenticated_at
        ? new Date(row.last_authenticated_at * 1_000).toISOString()
        : null,
    })),
  }, { headers: { "cache-control": "private, no-store" } });
}
