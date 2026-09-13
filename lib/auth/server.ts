import {
  PrivyClient,
  type LinkedAccount,
  type User as PrivyUser,
  type VerifyAccessTokenResponse,
} from "@privy-io/node";
import { getAddress } from "viem";

import { getChatGPTUser } from "@/app/chatgpt-auth";
import {
  adminIdentityAllowlist,
  AuthRequestError,
  authProviderFromBindings,
  extractBearerToken,
  privyServerConfig,
  ROBINHOOD_CHAIN_ID,
  type MemeticAuthProvider,
} from "@/lib/auth/config";
import { ensureMemberProfile } from "@/lib/entitlements/server";

const IDENTITY_SYNC_SECONDS = 5 * 60;
const MAX_SYNCED_WALLETS = 25;

export type AuthenticatedMember = {
  id: string;
  provider: MemeticAuthProvider;
  subject: string;
  displayName: string;
  email: string | null;
};

type IdentityRow = {
  user_id: string;
  last_synced_at: number;
  email: string;
  display_name: string;
};

type PrivyWallet = {
  address: string;
  verifiedAt: number;
};

let cachedPrivyClient: {
  appId: string;
  appSecret: string;
  jwtVerificationKey?: string;
  client: PrivyClient;
} | null = null;

function getPrivyClient(bindings: Record<string, unknown>) {
  const config = privyServerConfig(bindings);
  if (
    cachedPrivyClient?.appId === config.appId
    && cachedPrivyClient.appSecret === config.appSecret
    && cachedPrivyClient.jwtVerificationKey === config.jwtVerificationKey
  ) return cachedPrivyClient.client;

  const client = new PrivyClient({
    appId: config.appId,
    appSecret: config.appSecret,
    ...(config.jwtVerificationKey ? { jwtVerificationKey: config.jwtVerificationKey } : {}),
    timeout: 5_000,
    maxRetries: 1,
    logLevel: "error",
  });
  cachedPrivyClient = { ...config, client };
  return client;
}

function normalizedEmail(user: PrivyUser): string | null {
  for (const account of user.linked_accounts) {
    if (account.type === "email") return account.address.trim().toLowerCase();
    if ("email" in account && typeof account.email === "string" && account.email.trim()) {
      return account.email.trim().toLowerCase();
    }
  }
  return null;
}

function displayName(user: PrivyUser, email: string | null, wallets: PrivyWallet[]) {
  for (const account of user.linked_accounts) {
    if ("name" in account && typeof account.name === "string" && account.name.trim()) {
      return account.name.trim().slice(0, 160);
    }
    if ("username" in account && typeof account.username === "string" && account.username.trim()) {
      return account.username.trim().slice(0, 160);
    }
  }
  if (email) return email.split("@")[0].slice(0, 160);
  if (wallets[0]) return `${wallets[0].address.slice(0, 6)}…${wallets[0].address.slice(-4)}`;
  return "Memetic State researcher";
}

function isExternalEthereumWallet(account: LinkedAccount) {
  if (account.type !== "wallet" || !("chain_type" in account) || account.chain_type !== "ethereum") return false;
  const connector = "connector_type" in account && typeof account.connector_type === "string"
    ? account.connector_type.toLowerCase()
    : "";
  const walletClient = "wallet_client_type" in account && typeof account.wallet_client_type === "string"
    ? account.wallet_client_type.toLowerCase()
    : "";
  return connector !== "embedded" && walletClient !== "privy" && walletClient !== "privy-v2";
}

function externalWallets(user: PrivyUser): PrivyWallet[] {
  const deduped = new Map<string, PrivyWallet>();
  for (const account of user.linked_accounts) {
    if (!isExternalEthereumWallet(account) || !("address" in account) || typeof account.address !== "string") continue;
    try {
      const address = getAddress(account.address).toLowerCase();
      const verifiedAt = "verified_at" in account && typeof account.verified_at === "number"
        ? account.verified_at
        : Math.floor(Date.now() / 1_000);
      const previous = deduped.get(address);
      if (!previous || verifiedAt < previous.verifiedAt) deduped.set(address, { address, verifiedAt });
    } catch {
      // Privy is authoritative, but malformed linked-account data must not enter the ledger.
    }
  }
  return [...deduped.values()]
    .sort((a, b) => a.verifiedAt - b.verifiedAt)
    .slice(0, MAX_SYNCED_WALLETS);
}

async function readIdentity(db: D1Database, subject: string) {
  return db.prepare(`
    SELECT i.user_id, i.last_synced_at, p.email, p.display_name
    FROM member_identities i
    JOIN member_profiles p ON p.user_id = i.user_id
    WHERE i.provider = 'privy' AND i.subject = ?
    LIMIT 1
  `).bind(subject).first<IdentityRow>();
}

async function candidateMemberIds(
  db: D1Database,
  email: string | null,
  wallets: PrivyWallet[],
) {
  const candidates = new Set<string>();
  if (wallets.length) {
    const placeholders = wallets.map(() => "?").join(", ");
    const result = await db.prepare(`
      SELECT DISTINCT user_id FROM linked_wallets
      WHERE wallet_address IN (${placeholders})
    `).bind(...wallets.map((wallet) => wallet.address)).all<{ user_id: string }>();
    for (const row of result.results ?? []) candidates.add(row.user_id);
  }
  if (email) {
    const result = await db.prepare(`
      SELECT user_id FROM member_profiles
      WHERE lower(email) = ?
      LIMIT 3
    `).bind(email).all<{ user_id: string }>();
    for (const row of result.results ?? []) candidates.add(row.user_id);
  }
  return candidates;
}

async function assertWalletOwnership(
  db: D1Database,
  memberId: string,
  wallets: PrivyWallet[],
) {
  if (!wallets.length) return;
  const placeholders = wallets.map(() => "?").join(", ");
  const result = await db.prepare(`
    SELECT wallet_address, user_id FROM linked_wallets
    WHERE wallet_address IN (${placeholders}) AND user_id != ?
  `).bind(...wallets.map((wallet) => wallet.address), memberId).all<{ wallet_address: string; user_id: string }>();
  if ((result.results ?? []).length) throw new AuthRequestError("identity_conflict", 409);
}

async function syncPrivyUser(
  db: D1Database,
  user: PrivyUser,
  existing: IdentityRow | null,
  nowSeconds: number,
): Promise<AuthenticatedMember> {
  const wallets = externalWallets(user);
  const email = normalizedEmail(user);
  const name = displayName(user, email, wallets);
  let memberId = existing?.user_id ?? "";

  if (!memberId) {
    const candidates = await candidateMemberIds(db, email, wallets);
    if (candidates.size > 1) throw new AuthRequestError("identity_conflict", 409);
    memberId = candidates.values().next().value ?? user.id;
  }
  await assertWalletOwnership(db, memberId, wallets);

  const statements = [
    db.prepare(`
      INSERT INTO member_profiles (user_id, email, display_name, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(user_id) DO UPDATE SET
        email = excluded.email,
        display_name = excluded.display_name,
        updated_at = excluded.updated_at
    `).bind(memberId, email ?? "", name, nowSeconds, nowSeconds),
    db.prepare(`
      INSERT INTO member_identities
        (provider, subject, user_id, last_authenticated_at, last_synced_at, created_at, updated_at)
      VALUES ('privy', ?, ?, ?, ?, ?, ?)
      ON CONFLICT(provider, subject) DO UPDATE SET
        user_id = excluded.user_id,
        last_authenticated_at = excluded.last_authenticated_at,
        last_synced_at = excluded.last_synced_at,
        updated_at = excluded.updated_at
    `).bind(user.id, memberId, nowSeconds, nowSeconds, nowSeconds, nowSeconds),
    db.prepare(`
      UPDATE linked_wallets SET is_primary = 0, updated_at = ?
      WHERE user_id = ? AND source = 'privy'
    `).bind(nowSeconds, memberId),
  ];

  if (wallets.length) {
    const placeholders = wallets.map(() => "?").join(", ");
    statements.push(db.prepare(`
      DELETE FROM linked_wallets
      WHERE user_id = ? AND source = 'privy' AND wallet_address NOT IN (${placeholders})
    `).bind(memberId, ...wallets.map((wallet) => wallet.address)));
  } else {
    statements.push(db.prepare(`
      DELETE FROM linked_wallets WHERE user_id = ? AND source = 'privy'
    `).bind(memberId));
  }

  wallets.forEach((wallet, index) => {
    statements.push(db.prepare(`
      INSERT INTO linked_wallets
        (wallet_address, user_id, chain_id, is_primary, verified_at, updated_at, source)
      VALUES (?, ?, ?, ?, ?, ?, 'privy')
      ON CONFLICT(wallet_address) DO UPDATE SET
        user_id = excluded.user_id,
        chain_id = excluded.chain_id,
        is_primary = excluded.is_primary,
        verified_at = excluded.verified_at,
        updated_at = excluded.updated_at,
        source = excluded.source
    `).bind(
      wallet.address,
      memberId,
      ROBINHOOD_CHAIN_ID,
      index === 0 ? 1 : 0,
      wallet.verifiedAt,
      nowSeconds,
    ));
  });
  await db.batch(statements);

  return { id: memberId, provider: "privy", subject: user.id, displayName: name, email };
}

async function authenticatePrivyMember(input: {
  request: Request;
  db: D1Database;
  bindings: Record<string, unknown>;
  forceIdentitySync?: boolean;
}): Promise<AuthenticatedMember | null> {
  const token = extractBearerToken(input.request);
  if (!token) return null;
  const client = getPrivyClient(input.bindings);

  let tokenClaims: VerifyAccessTokenResponse;
  try {
    tokenClaims = await client.utils().auth().verifyAccessToken(token);
  } catch {
    throw new AuthRequestError("invalid_access_token", 401);
  }

  const nowSeconds = Math.floor(Date.now() / 1_000);
  const existing = await readIdentity(input.db, tokenClaims.user_id);
  const syncRequired = input.forceIdentitySync
    || !existing
    || existing.last_synced_at <= nowSeconds - IDENTITY_SYNC_SECONDS;

  if (!syncRequired && existing) {
    await input.db.prepare(`
      UPDATE member_identities
      SET last_authenticated_at = ?, updated_at = ?
      WHERE provider = 'privy' AND subject = ? AND last_authenticated_at < ?
    `).bind(nowSeconds, nowSeconds, tokenClaims.user_id, nowSeconds - 60).run();
    return {
      id: existing.user_id,
      provider: "privy",
      subject: tokenClaims.user_id,
      displayName: existing.display_name,
      email: existing.email || null,
    };
  }

  let user: PrivyUser;
  try {
    user = await client.users()._get(tokenClaims.user_id);
  } catch {
    throw new AuthRequestError("identity_sync_unavailable", 503);
  }
  if (user.id !== tokenClaims.user_id) throw new AuthRequestError("identity_mismatch", 401);
  return syncPrivyUser(input.db, user, existing, nowSeconds);
}

export async function authenticateMember(input: {
  request: Request;
  db: D1Database;
  bindings?: Record<string, unknown>;
  forceIdentitySync?: boolean;
}): Promise<AuthenticatedMember | null> {
  const bindings = input.bindings ?? {};
  const provider = authProviderFromBindings(bindings);
  if (provider === "privy") {
    return authenticatePrivyMember({ ...input, bindings });
  }

  const user = await getChatGPTUser();
  if (!user) return null;
  await ensureMemberProfile(input.db, user);
  return {
    id: user.id,
    provider: "chatgpt",
    subject: user.id,
    displayName: user.displayName,
    email: user.email,
  };
}

export function memberIsAdmin(
  member: AuthenticatedMember,
  bindings: Record<string, unknown>,
) {
  const allowlist = adminIdentityAllowlist(bindings);
  if (!allowlist.size) return false;
  return [member.id, member.subject, member.email ?? ""]
    .some((identity) => identity && allowlist.has(identity.toLowerCase()));
}
