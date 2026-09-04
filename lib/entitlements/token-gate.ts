import {
  PREMIUM_HOLDER_THRESHOLD_BPS,
  TOKEN_GATE_CACHE_SECONDS,
  TOKEN_GATE_CHAIN_ID,
  TOKEN_GATE_ERROR_CACHE_SECONDS,
  readTokenGateOnchain,
  tokenAdapterStatus,
  type TokenAdapterStatus,
  type TokenGateOnchainResult,
} from "@/lib/entitlements/token-adapter";

export type PremiumAccessStatus =
  | "active"
  | "wallet_required"
  | "below_threshold"
  | "verification_unavailable"
  | "not_configured";

export type PremiumAccess = {
  tier: "public" | "premium";
  active: boolean;
  status: PremiumAccessStatus;
  thresholdBps: typeof PREMIUM_HOLDER_THRESHOLD_BPS;
  thresholdPercent: "0.05%";
  chainId: typeof TOKEN_GATE_CHAIN_ID;
  walletAddress: string | null;
  checkedAt: string | null;
  expiresAt: string | null;
  blockNumber: number | null;
  confirmations: number;
  providerCount: number;
  reason: string;
};

export type PremiumAccessEvaluation = {
  access: PremiumAccess;
  adapter: TokenAdapterStatus;
};

type LinkedWalletRow = { wallet_address: string; chain_id: number };
type GateCheckRow = {
  wallet_address: string;
  chain_id: number;
  contract_address: string;
  status: string;
  eligible: number;
  threshold_bps: number;
  block_number: number | null;
  confirmations: number;
  provider_count: number;
  checked_at: number;
  expires_at: number;
};

function iso(seconds: number | null) {
  return seconds === null ? null : new Date(seconds * 1_000).toISOString();
}

function baseAccess(status: PremiumAccessStatus, reason: string, walletAddress: string | null = null): PremiumAccess {
  return {
    tier: status === "active" ? "premium" : "public",
    active: status === "active",
    status,
    thresholdBps: PREMIUM_HOLDER_THRESHOLD_BPS,
    thresholdPercent: "0.05%",
    chainId: TOKEN_GATE_CHAIN_ID,
    walletAddress,
    checkedAt: null,
    expiresAt: null,
    blockNumber: null,
    confirmations: 0,
    providerCount: 0,
    reason,
  };
}

function resultAccess(result: TokenGateOnchainResult, nowSeconds: number): PremiumAccess {
  const status: PremiumAccessStatus = result.eligible ? "active" : "below_threshold";
  const expiresAt = nowSeconds + TOKEN_GATE_CACHE_SECONDS;
  return {
    ...baseAccess(status, result.eligible
        ? "Wallet meets the 0.05% holder threshold at the verified block."
        : "Wallet is linked, but the current balance is below the 0.05% holder threshold.", result.walletAddress),
    checkedAt: iso(nowSeconds),
    expiresAt: iso(expiresAt),
    blockNumber: result.blockNumber,
    confirmations: result.confirmations,
    providerCount: result.providerCount,
  };
}

async function revokeTokenGrant(db: D1Database, userId: string, nowSeconds: number) {
  try {
    await db.prepare(`
      UPDATE entitlement_grants
      SET status = 'revoked', ends_at = ?, reference = 'token-gate-failed'
      WHERE id = ? AND user_id = ? AND source = 'token' AND status = 'active'
    `).bind(nowSeconds, `token-holder:${userId}`, userId).run();
  } catch {
    // A missing or temporarily unavailable ledger must never turn into access.
  }
}

async function persistCheck(db: D1Database, userId: string, result: {
  walletAddress: string;
  contractAddress: string;
  status: "eligible" | "below_threshold" | "unavailable";
  eligible: boolean;
  balanceRaw: string | null;
  totalSupplyRaw: string | null;
  blockNumber: number | null;
  confirmations: number;
  providerCount: number;
  errorCode: string | null;
  checkedAt: number;
  expiresAt: number;
}) {
  await db.prepare(`
    INSERT INTO token_gate_checks
      (user_id, wallet_address, chain_id, contract_address, status, eligible,
       balance_raw, total_supply_raw, threshold_bps, block_number, confirmations,
       provider_count, error_code, checked_at, expires_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(user_id) DO UPDATE SET
      wallet_address = excluded.wallet_address,
      chain_id = excluded.chain_id,
      contract_address = excluded.contract_address,
      status = excluded.status,
      eligible = excluded.eligible,
      balance_raw = excluded.balance_raw,
      total_supply_raw = excluded.total_supply_raw,
      threshold_bps = excluded.threshold_bps,
      block_number = excluded.block_number,
      confirmations = excluded.confirmations,
      provider_count = excluded.provider_count,
      error_code = excluded.error_code,
      checked_at = excluded.checked_at,
      expires_at = excluded.expires_at,
      updated_at = excluded.updated_at
  `).bind(
    userId,
    result.walletAddress,
    TOKEN_GATE_CHAIN_ID,
    result.contractAddress,
    result.status,
    result.eligible ? 1 : 0,
    result.balanceRaw,
    result.totalSupplyRaw,
    PREMIUM_HOLDER_THRESHOLD_BPS,
    result.blockNumber,
    result.confirmations,
    result.providerCount,
    result.errorCode,
    result.checkedAt,
    result.expiresAt,
    result.checkedAt,
  ).run();
}

async function persistCheckSafe(db: D1Database, userId: string, result: Parameters<typeof persistCheck>[2]) {
  try {
    await persistCheck(db, userId, result);
    return true;
  } catch {
    return false;
  }
}

async function upsertTokenGrant(db: D1Database, userId: string, nowSeconds: number, endsAt: number, reference: string) {
  await db.prepare(`
    INSERT INTO entitlement_grants
      (id, user_id, source, plan, status, allowances_json, reference, starts_at, ends_at, created_at)
    VALUES (?, ?, 'token', 'researcher', 'active', '{}', ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      status = 'active',
      plan = 'researcher',
      allowances_json = '{}',
      reference = excluded.reference,
      starts_at = excluded.starts_at,
      ends_at = excluded.ends_at
  `).bind(`token-holder:${userId}`, userId, reference, nowSeconds, endsAt, nowSeconds).run();
}

function checkAccess(row: GateCheckRow): PremiumAccess {
  const status: PremiumAccessStatus = row.status === "eligible" && row.eligible
    ? "active"
    : row.status === "below_threshold" ? "below_threshold" : "verification_unavailable";
  return {
    ...baseAccess(status, status === "active"
      ? "Wallet meets the 0.05% holder threshold at the verified block."
      : status === "below_threshold"
        ? "Wallet is linked, but the current balance is below the 0.05% holder threshold."
        : "The holder check could not reach a safe provider quorum. Premium access remains locked.", row.wallet_address),
    checkedAt: iso(row.checked_at),
    expiresAt: iso(row.expires_at),
    blockNumber: row.block_number,
    confirmations: row.confirmations,
    providerCount: row.provider_count,
  };
}

export async function evaluatePremiumAccess(input: {
  db: D1Database;
  userId: string;
  bindings?: Record<string, unknown>;
  force?: boolean;
  nowSeconds?: number;
  fetcher?: typeof fetch;
}): Promise<PremiumAccessEvaluation> {
  const nowSeconds = input.nowSeconds ?? Math.floor(Date.now() / 1_000);
  const adapter = tokenAdapterStatus(input.bindings ?? {});
  if (!adapter.grantingEnabled || !adapter.contractAddress) {
    await revokeTokenGrant(input.db, input.userId, nowSeconds);
    return {
      adapter,
      access: baseAccess("not_configured", adapter.reason),
    };
  }

  const wallet = await input.db.prepare(`
    SELECT wallet_address, chain_id
    FROM linked_wallets
    WHERE user_id = ? AND is_primary = 1
    ORDER BY verified_at DESC
    LIMIT 1
  `).bind(input.userId).first<LinkedWalletRow>();
  if (!wallet) {
    await revokeTokenGrant(input.db, input.userId, nowSeconds);
    return {
      adapter,
      access: baseAccess("wallet_required", "Link a wallet to verify the 0.05% holder threshold."),
    };
  }
  if (wallet.chain_id !== TOKEN_GATE_CHAIN_ID) {
    await revokeTokenGrant(input.db, input.userId, nowSeconds);
    return {
      adapter,
      access: baseAccess("verification_unavailable", "The linked wallet is on an unsupported chain." , wallet.wallet_address),
    };
  }

  if (!input.force) {
    try {
      const cached = await input.db.prepare(`
        SELECT wallet_address, chain_id, contract_address, status, eligible, threshold_bps,
               block_number, confirmations, provider_count, checked_at, expires_at
        FROM token_gate_checks
        WHERE user_id = ? AND chain_id = ? AND contract_address = ? AND wallet_address = ?
          AND threshold_bps = ? AND provider_count >= ? AND expires_at > ?
        LIMIT 1
      `).bind(
        input.userId,
        TOKEN_GATE_CHAIN_ID,
        adapter.contractAddress,
        wallet.wallet_address,
        PREMIUM_HOLDER_THRESHOLD_BPS,
        adapter.quorum,
        nowSeconds,
      ).first<GateCheckRow>();
      if (cached) {
        const access = checkAccess(cached);
        try {
          if (access.active) {
            await upsertTokenGrant(input.db, input.userId, nowSeconds, cached.expires_at, `holder-check:${cached.block_number ?? "latest"}`);
          } else {
            await revokeTokenGrant(input.db, input.userId, nowSeconds);
          }
        } catch {
          await revokeTokenGrant(input.db, input.userId, nowSeconds);
          return {
            adapter,
            access: baseAccess("verification_unavailable", "The holder check could not be restored safely. Premium access remains locked.", wallet.wallet_address),
          };
        }
        return { adapter, access };
      }
    } catch {
      await revokeTokenGrant(input.db, input.userId, nowSeconds);
      return {
        adapter,
        access: baseAccess("verification_unavailable", "The holder check storage is temporarily unavailable. Premium access remains locked.", wallet.wallet_address),
      };
    }
  }

  try {
    const result = await readTokenGateOnchain({
      walletAddress: wallet.wallet_address,
      bindings: input.bindings,
      fetcher: input.fetcher,
    });
    const expiresAt = nowSeconds + TOKEN_GATE_CACHE_SECONDS;
    const persisted = await persistCheckSafe(input.db, input.userId, {
      walletAddress: result.walletAddress,
      contractAddress: result.contractAddress,
      status: result.eligible ? "eligible" : "below_threshold",
      eligible: result.eligible,
      balanceRaw: result.balanceRaw,
      totalSupplyRaw: result.totalSupplyRaw,
      blockNumber: result.blockNumber,
      confirmations: result.confirmations,
      providerCount: result.providerCount,
      errorCode: null,
      checkedAt: nowSeconds,
      expiresAt,
    });
    if (!persisted) {
      await revokeTokenGrant(input.db, input.userId, nowSeconds);
      return {
        adapter,
        access: baseAccess("verification_unavailable", "The holder check could not be stored safely. Premium access remains locked.", wallet.wallet_address),
      };
    }
    if (result.eligible) {
      await upsertTokenGrant(input.db, input.userId, nowSeconds, expiresAt, `holder-check:${result.blockNumber}`);
    } else {
      await revokeTokenGrant(input.db, input.userId, nowSeconds);
    }
    return { adapter, access: resultAccess(result, nowSeconds) };
  } catch (error) {
    const expiresAt = nowSeconds + TOKEN_GATE_ERROR_CACHE_SECONDS;
    const errorCode = (error instanceof Error ? error.message : "token_gate_unavailable")
      .toLowerCase().replace(/[^a-z0-9]+/g, "_").slice(0, 96) || "token_gate_unavailable";
    await persistCheckSafe(input.db, input.userId, {
      walletAddress: wallet.wallet_address,
      contractAddress: adapter.contractAddress,
      status: "unavailable",
      eligible: false,
      balanceRaw: null,
      totalSupplyRaw: null,
      blockNumber: null,
      confirmations: 0,
      providerCount: 0,
      errorCode,
      checkedAt: nowSeconds,
      expiresAt,
    });
    await revokeTokenGrant(input.db, input.userId, nowSeconds);
    return {
      adapter,
      access: {
        ...baseAccess("verification_unavailable", "The holder check is temporarily unavailable. Premium access remains locked.", wallet.wallet_address),
        checkedAt: iso(nowSeconds),
        expiresAt: iso(expiresAt),
      },
    };
  }
}
