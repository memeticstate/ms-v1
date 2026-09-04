import type { ChatGPTUser } from "@/app/chatgpt-auth";
import {
  ENTITLEMENT_CAPABILITIES,
  entitlementPeriodKey,
  parseEntitlementAllowances,
  resolveEntitlementProfile,
  type EntitlementAllowances,
  type EntitlementCapability,
  type EntitlementGrantInput,
  type EntitlementPlan,
  type EntitlementProfile,
  type EntitlementSource,
} from "@/lib/entitlements/model";

type GrantRow = {
  id: string;
  source: string;
  plan: string;
  status: string;
  allowances_json: string;
  starts_at: number;
  ends_at: number | null;
};

type UsageRow = { capability: string; units: number };

function isPlan(value: string): value is EntitlementPlan {
  return ["field", "founding", "researcher", "team"].includes(value);
}

function isSource(value: string): value is EntitlementSource {
  return ["public", "founding", "paid", "token", "admin"].includes(value);
}

export async function ensureMemberProfile(db: D1Database, user: ChatGPTUser) {
  await db.prepare(`
    INSERT INTO member_profiles (user_id, email, display_name, created_at, updated_at)
    VALUES (?, ?, ?, unixepoch(), unixepoch())
    ON CONFLICT(user_id) DO UPDATE SET
      email = excluded.email,
      display_name = excluded.display_name,
      updated_at = unixepoch()
  `).bind(user.id, user.email, user.displayName).run();
}

export async function readEntitlementProfile(
  db: D1Database,
  userId: string,
  nowSeconds = Math.floor(Date.now() / 1_000),
): Promise<EntitlementProfile> {
  const periodKey = entitlementPeriodKey(new Date(nowSeconds * 1_000));
  const [grantResult, usageResult] = await Promise.all([
    db.prepare(`
      SELECT id, source, plan, status, allowances_json, starts_at, ends_at
      FROM entitlement_grants
      WHERE user_id = ? AND status = 'active' AND starts_at <= ? AND (ends_at IS NULL OR ends_at > ?)
      ORDER BY starts_at ASC
    `).bind(userId, nowSeconds, nowSeconds).all<GrantRow>(),
    db.prepare(`
      SELECT capability, COALESCE(SUM(units), 0) AS units
      FROM entitlement_usage
      WHERE user_id = ? AND period_key = ?
      GROUP BY capability
    `).bind(userId, periodKey).all<UsageRow>(),
  ]);

  const grants: EntitlementGrantInput[] = (grantResult.results ?? []).flatMap((row) => {
    if (!isPlan(row.plan) || !isSource(row.source)) return [];
    return [{
      id: row.id,
      source: row.source,
      plan: row.plan,
      status: row.status,
      startsAt: row.starts_at,
      endsAt: row.ends_at,
      allowances: parseEntitlementAllowances(row.allowances_json),
    }];
  });
  const usage = Object.fromEntries((usageResult.results ?? []).flatMap((row) =>
    ENTITLEMENT_CAPABILITIES.includes(row.capability as EntitlementCapability)
      ? [[row.capability, row.units]]
      : [])) as Partial<EntitlementAllowances>;
  return resolveEntitlementProfile(grants, usage, nowSeconds);
}

export async function reserveEntitlementUsage(input: {
  db: D1Database;
  userId: string;
  capability: Exclude<EntitlementCapability, "server_watch_slots" | "team_seats">;
  units: number;
  idempotencyKey: string;
  metadata?: Record<string, unknown>;
}) {
  const units = Math.max(1, Math.floor(input.units));
  const existing = await input.db.prepare(`
    SELECT id FROM entitlement_usage
    WHERE idempotency_key = ? AND user_id = ? AND capability = ?
    LIMIT 1
  `).bind(input.idempotencyKey, input.userId, input.capability).first<{ id: string }>();
  if (existing) return { accepted: true, idempotent: true };

  const profile = await readEntitlementProfile(input.db, input.userId);
  const allowance = profile.allowances[input.capability];
  const result = await input.db.prepare(`
    INSERT INTO entitlement_usage
      (id, user_id, capability, units, period_key, idempotency_key, metadata_json, observed_at)
    SELECT ?, ?, ?, ?, ?, ?, ?, unixepoch()
    WHERE COALESCE((
      SELECT SUM(units) FROM entitlement_usage
      WHERE user_id = ? AND capability = ? AND period_key = ?
    ), 0) + ? <= ?
  `).bind(
    crypto.randomUUID(), input.userId, input.capability, units, profile.periodKey,
    input.idempotencyKey, JSON.stringify(input.metadata ?? {}), input.userId,
    input.capability, profile.periodKey, units, allowance,
  ).run();
  return { accepted: (result.meta?.changes ?? 0) === 1, idempotent: false };
}
