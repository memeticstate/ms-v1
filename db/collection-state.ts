import { getD1 } from "@/db";

const COLLECTION_ID = "affinity";
const LEASE_MS = 4 * 60 * 1000;
const DEFAULT_MIN_INTERVAL_MS = 4 * 60 * 1000;

function safeErrorCode(message: string) {
  return message.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 96) || "unknown";
}

export async function acquireCollectionLease(options: {
  now?: number;
  minIntervalMs?: number;
  force?: boolean;
} = {}) {
  const now = options.now ?? Date.now();
  const minIntervalMs = options.minIntervalMs ?? DEFAULT_MIN_INTERVAL_MS;
  const db = getD1();
  await db.prepare(`INSERT OR IGNORE INTO collection_state (id, locked_until, consecutive_failures)
    VALUES (?, 0, 0)`).bind(COLLECTION_ID).run();
  const result = await db.prepare(`UPDATE collection_state
    SET locked_until = ?, last_attempt_at = ?
    WHERE id = ? AND locked_until <= ?
      AND (? = 1 OR last_success_at IS NULL OR last_success_at <= ?)`)
    .bind(now + LEASE_MS, now, COLLECTION_ID, now, options.force ? 1 : 0, now - minIntervalMs)
    .run();
  return Number(result.meta?.changes ?? 0) === 1;
}

export async function recordCollectionSuccess(snapshotId: string | null, now = Date.now()) {
  const db = getD1();
  await db.prepare(`UPDATE collection_state
    SET locked_until = 0, last_success_at = ?, last_snapshot_id = ?,
        last_error_code = NULL, consecutive_failures = 0
    WHERE id = ?`)
    .bind(now, snapshotId, COLLECTION_ID)
    .run();
}

export async function recordCollectionFailure(message: string, now = Date.now()) {
  const db = getD1();
  await db.prepare(`UPDATE collection_state
    SET locked_until = 0, last_failure_at = ?, last_error_code = ?,
        consecutive_failures = consecutive_failures + 1
    WHERE id = ?`)
    .bind(now, safeErrorCode(message), COLLECTION_ID)
    .run();
}

export async function getCollectionHealth() {
  const row = await getD1().prepare(`SELECT locked_until, last_attempt_at, last_success_at,
      last_failure_at, last_snapshot_id, last_error_code, consecutive_failures
    FROM collection_state WHERE id = ?`)
    .bind(COLLECTION_ID)
    .first<{
      locked_until: number;
      last_attempt_at: number | null;
      last_success_at: number | null;
      last_failure_at: number | null;
      last_snapshot_id: string | null;
      last_error_code: string | null;
      consecutive_failures: number;
    }>();
  if (!row) return { status: "pending" as const, cadenceMinutes: 5 };

  const iso = (value: number | null) => value ? new Date(value).toISOString() : null;
  const stale = !row.last_success_at || Date.now() - row.last_success_at > 15 * 60 * 1000;
  return {
    status: row.locked_until > Date.now()
      ? "collecting" as const
      : row.consecutive_failures > 0 || stale
        ? row.last_attempt_at ? "degraded" as const : "pending" as const
        : "healthy" as const,
    cadenceMinutes: 5,
    lastAttemptAt: iso(row.last_attempt_at),
    lastSuccessAt: iso(row.last_success_at),
    lastFailureAt: iso(row.last_failure_at),
    lastSnapshotId: row.last_snapshot_id,
    lastErrorCode: row.last_error_code,
    consecutiveFailures: row.consecutive_failures,
  };
}
