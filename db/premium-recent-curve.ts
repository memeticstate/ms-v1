import { getD1 } from "@/db";
import { acquireAuxJob, releaseAuxJob } from "@/db/pons-research";
import { PremiumRequestError } from "@/lib/entitlements/premium-boundary";
import { readRecentPonsCurve } from "@/lib/ingestion/pons-rpc";
import { RECENT_CURVE_CACHE_MS, type RecentCurveCheck, type RecentCurveResult } from "@/lib/premium/recent-curve";

type Row = { payload_json: string | null; last_error: string | null; retry_after: number };
export async function loadRecentCurveCheck(token: string): Promise<RecentCurveResult> {
  const row = await getD1().prepare("SELECT payload_json, last_error, retry_after FROM pons_recent_curve_checks WHERE token_address = ?").bind(token).first<Row>();
  let check: RecentCurveCheck | null = null;
  try { check = row?.payload_json ? JSON.parse(row.payload_json) : null; } catch { /* A damaged cache is unavailable. */ }
  return { check, lastError: row?.last_error ?? null, retryAt: row?.retry_after ? new Date(row.retry_after).toISOString() : null };
}

export async function refreshRecentCurveCheck(token: string): Promise<RecentCurveResult> {
  const db = getD1();
  // Factory-confirmed identities are usable before their historical trades catch up.
  const launch = await db.prepare("SELECT curve_address, block_number FROM pons_launches WHERE token_address = ?").bind(token).first<{ curve_address: string; block_number: number }>();
  if (!launch) throw new PremiumRequestError(404, "token_not_discovered");
  const cached = await loadRecentCurveCheck(token);
  if (cached.retryAt && Date.parse(cached.retryAt) > Date.now()) return cached;
  if (!await acquireAuxJob("recent-curve-rpc", 5_000)) throw new PremiumRequestError(429, "recent_check_busy");
  let acquired = false;
  let leaseUntil = 0;
  try {
    const now = Date.now();
    leaseUntil = now + 30_000;
    await db.prepare("INSERT OR IGNORE INTO pons_recent_curve_checks (token_address) VALUES (?)").bind(token).run();
    const lock = await db.prepare("UPDATE pons_recent_curve_checks SET locked_until = ?, retry_after = ? WHERE token_address = ? AND locked_until <= ? AND retry_after <= ?")
      .bind(leaseUntil, now + RECENT_CURVE_CACHE_MS, token, now, now).run();
    acquired = Number(lock.meta?.changes) === 1;
    if (!acquired) return loadRecentCurveCheck(token);
    const check = await readRecentPonsCurve(token, launch.curve_address, launch.block_number);
    await db.prepare("UPDATE pons_recent_curve_checks SET payload_json = ?, last_error = NULL WHERE token_address = ? AND locked_until = ?").bind(JSON.stringify(check), token, leaseUntil).run();
  } catch {
    if (acquired) await db.prepare("UPDATE pons_recent_curve_checks SET last_error = 'recent_check_unavailable' WHERE token_address = ? AND locked_until = ?").bind(token, leaseUntil).run();
    else throw new PremiumRequestError(503, "recent_check_unavailable");
  } finally {
    if (acquired) await db.prepare("UPDATE pons_recent_curve_checks SET locked_until = 0 WHERE token_address = ? AND locked_until = ?").bind(token, leaseUntil).run();
    await releaseAuxJob("recent-curve-rpc");
  }
  return loadRecentCurveCheck(token);
}
