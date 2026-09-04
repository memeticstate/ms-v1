import { getD1 } from "@/db";
import { getCollectionHealth } from "@/db/collection-state";
import type { CollectionRunSummary, EngineAlert, EngineHealth, SourceHealth } from "@/lib/affinity-model";

export type CollectionTrigger = "scheduled" | "request-watchdog" | "manual";
export type CollectionLane = "heartbeat" | "registry" | "deep-attestation" | "full" | "pons-index"
  | "pons-history:v1-current" | "pons-history:v1-legacy";

export type SourceObservationInput = {
  source: string;
  status: "ok" | "stale" | "failed";
  startedAt: number;
  completedAt: number;
  freshnessMs?: number | null;
  recordCount?: number;
  errorCode?: string | null;
  metadata?: Record<string, unknown>;
};

const ABANDONED_RUN_MS = 10 * 60 * 1000;

export function safeErrorCode(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 96) || "unknown";
}

export async function startCollectionRun(trigger: CollectionTrigger, lane: CollectionLane) {
  const id = crypto.randomUUID();
  const startedAt = Date.now();
  const db = getD1();
  await db.batch([
    db.prepare(`UPDATE collection_runs
      SET status = 'failed', phase = 'abandoned', completed_at = ?, duration_ms = ? - started_at,
          error_code = 'run_timeout'
      WHERE status = 'running' AND started_at < ?`)
      .bind(startedAt, startedAt, startedAt - ABANDONED_RUN_MS),
    db.prepare(`INSERT INTO collection_runs
      (id, trigger, lane, status, phase, started_at, metadata_json)
      VALUES (?, ?, ?, 'running', 'lease-acquired', ?, '{}')`)
      .bind(id, trigger, lane, startedAt),
  ]);
  return { id, startedAt };
}

export async function updateRunPhase(runId: string, phase: string, metadata?: Record<string, unknown>) {
  const db = getD1();
  if (metadata) {
    await db.prepare(`UPDATE collection_runs SET phase = ?, metadata_json = ? WHERE id = ?`)
      .bind(phase, JSON.stringify(metadata), runId)
      .run();
    return;
  }
  await db.prepare(`UPDATE collection_runs SET phase = ? WHERE id = ?`).bind(phase, runId).run();
}

export async function recordSourceObservation(runId: string, input: SourceObservationInput) {
  await getD1().prepare(`INSERT OR REPLACE INTO source_observations
    (run_id, source, status, started_at, completed_at, latency_ms, freshness_ms, record_count, error_code, metadata_json)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .bind(
      runId,
      input.source,
      input.status,
      input.startedAt,
      input.completedAt,
      Math.max(0, input.completedAt - input.startedAt),
      input.freshnessMs ?? null,
      input.recordCount ?? 0,
      input.errorCode ?? null,
      JSON.stringify(input.metadata ?? {}),
    )
    .run();
}

export async function completeCollectionRun(runId: string, startedAt: number, input: {
  snapshotId: string | null;
  discoveredSpecies: number;
  observedSpecies: number;
  verifiedSpecies: number;
  warningCount: number;
  metadata?: Record<string, unknown>;
}) {
  const completedAt = Date.now();
  await getD1().prepare(`UPDATE collection_runs
    SET status = 'succeeded', phase = 'committed', completed_at = ?, duration_ms = ?, snapshot_id = ?,
        discovered_species = ?, observed_species = ?, verified_species = ?, warning_count = ?, metadata_json = ?
    WHERE id = ?`)
    .bind(
      completedAt,
      completedAt - startedAt,
      input.snapshotId,
      input.discoveredSpecies,
      input.observedSpecies,
      input.verifiedSpecies,
      input.warningCount,
      JSON.stringify(input.metadata ?? {}),
      runId,
    )
    .run();
}

export async function failCollectionRun(runId: string, startedAt: number, phase: string, error: unknown) {
  const completedAt = Date.now();
  const code = safeErrorCode(error instanceof Error ? error.message : "collection failed");
  await getD1().prepare(`UPDATE collection_runs
    SET status = 'failed', phase = ?, completed_at = ?, duration_ms = ?, error_code = ?
    WHERE id = ?`)
    .bind(phase, completedAt, completedAt - startedAt, code, runId)
    .run();
  return code;
}

export async function recordEngineAlert(input: {
  severity: EngineAlert["severity"];
  code: string;
  entityType: string;
  entityId: string;
  message: string;
  evidence?: Record<string, unknown>;
  snapshotId?: string | null;
}) {
  const detectedAt = Date.now();
  const id = `${input.code}:${input.entityType}:${input.entityId}`;
  await getD1().prepare(`INSERT INTO engine_alerts
    (id, detected_at, severity, code, entity_type, entity_id, message, evidence_json, snapshot_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET detected_at = excluded.detected_at, severity = excluded.severity,
      message = excluded.message, evidence_json = excluded.evidence_json, snapshot_id = excluded.snapshot_id,
      resolved_at = NULL`)
    .bind(
      id,
      detectedAt,
      input.severity,
      input.code,
      input.entityType,
      input.entityId,
      input.message,
      JSON.stringify(input.evidence ?? {}),
      input.snapshotId ?? null,
    )
    .run();
}

export async function resolveEngineAlert(code: string, entityType: string, entityId: string) {
  await getD1().prepare(`UPDATE engine_alerts SET resolved_at = ?
    WHERE code = ? AND entity_type = ? AND entity_id = ? AND resolved_at IS NULL`)
    .bind(Date.now(), code, entityType, entityId)
    .run();
}

type RunRow = {
  id: string; trigger: string; lane: string; status: CollectionRunSummary["status"]; phase: string;
  started_at: number; completed_at: number | null; duration_ms: number | null; snapshot_id: string | null;
  discovered_species: number; observed_species: number; verified_species: number; warning_count: number; error_code: string | null;
};

function runSummary(row: RunRow): CollectionRunSummary {
  return {
    id: row.id,
    trigger: row.trigger,
    lane: row.lane,
    status: row.status,
    phase: row.phase,
    startedAt: new Date(row.started_at).toISOString(),
    completedAt: row.completed_at ? new Date(row.completed_at).toISOString() : null,
    durationMs: row.duration_ms,
    snapshotId: row.snapshot_id,
    discoveredSpecies: row.discovered_species,
    observedSpecies: row.observed_species,
    verifiedSpecies: row.verified_species,
    warningCount: row.warning_count,
    errorCode: row.error_code,
  };
}

export async function getEngineHealth(): Promise<EngineHealth> {
  const db = getD1();
  const [collection, latestRun, sourceRows, alerts, archive, registry] = await Promise.all([
    getCollectionHealth(),
    db.prepare(`SELECT id, trigger, lane, status, phase, started_at, completed_at, duration_ms, snapshot_id,
      discovered_species, observed_species, verified_species, warning_count, error_code
      FROM collection_runs ORDER BY started_at DESC LIMIT 1`).first<RunRow>(),
    db.prepare(`SELECT source, status, completed_at, latency_ms, freshness_ms, record_count, error_code
      FROM source_observations ORDER BY completed_at DESC LIMIT 100`).all<{
        source: string; status: SourceHealth["status"]; completed_at: number; latency_ms: number;
        freshness_ms: number | null; record_count: number; error_code: string | null;
      }>(),
    db.prepare(`SELECT id, detected_at, severity, code, entity_type, entity_id, message
      FROM engine_alerts WHERE resolved_at IS NULL ORDER BY detected_at DESC LIMIT 12`).all<{
        id: string; detected_at: number; severity: EngineAlert["severity"]; code: string;
        entity_type: string; entity_id: string; message: string;
      }>(),
    db.prepare(`SELECT
      (SELECT COUNT(*) FROM affinity_snapshots) AS snapshots,
      (SELECT COUNT(*) FROM species_observations) AS species_observations,
      (SELECT COUNT(*) FROM chain_blocks) AS chain_blocks`).first<{
        snapshots: number; species_observations: number; chain_blocks: number;
      }>(),
    db.prepare(`SELECT COUNT(*) AS assets, MAX(observed_at) AS last_observed_at,
      (SELECT COUNT(DISTINCT symbol) FROM robinhood_quotes WHERE observed_at > ?) AS quoted_habitats
      FROM robinhood_assets WHERE chain_id = 4663 AND status = 'ASSET_STATUS_ACTIVE'`)
      .bind(Date.now() - 30 * 60 * 1000).first<{
        assets: number; last_observed_at: number | null; quoted_habitats: number;
      }>(),
  ]);

  const latestSources = new Map<string, SourceHealth>();
  for (const row of sourceRows.results) {
    if (!latestSources.has(row.source)) {
      latestSources.set(row.source, {
        source: row.source,
        status: row.status,
        observedAt: new Date(row.completed_at).toISOString(),
        latencyMs: row.latency_ms,
        freshnessMs: row.freshness_ms,
        recordCount: row.record_count,
        errorCode: row.error_code,
      });
    }
  }

  const now = Date.now();
  const staleForMs = collection.lastSuccessAt ? Math.max(0, now - new Date(collection.lastSuccessAt).getTime()) : null;
  const critical = Boolean(collection.consecutiveFailures && collection.consecutiveFailures >= 3)
    || alerts.results.some((alert) => alert.severity === "critical");
  const stale = staleForMs === null || staleForMs > 20 * 60 * 1000;
  const failedSources = [...latestSources.values()].filter((item) => item.status === "failed").length;
  const status: EngineHealth["status"] = critical || (stale && Boolean(collection.lastSuccessAt))
    ? "critical"
    : collection.status === "degraded" || failedSources > 0 || stale
      ? collection.lastSuccessAt ? "degraded" : "pending"
      : "healthy";
  const warningAlerts = alerts.results.filter((alert) => alert.severity === "warning").length;
  const score = status === "healthy"
    ? Math.max(80, 100 - warningAlerts * 4)
    : status === "pending"
      ? 0
      : status === "critical"
        ? 35
        : Math.max(50, 85 - failedSources * 10 - warningAlerts * 4);

  return {
    status,
    score,
    collection: { ...collection, staleForMs, latestRun: latestRun ? runSummary(latestRun) : null },
    sources: [...latestSources.values()],
    alerts: alerts.results.map((row) => ({
      id: row.id,
      detectedAt: new Date(row.detected_at).toISOString(),
      severity: row.severity,
      code: row.code,
      entityType: row.entity_type,
      entityId: row.entity_id,
      message: row.message,
    })),
    archive: {
      snapshots: Number(archive?.snapshots ?? 0),
      speciesObservations: Number(archive?.species_observations ?? 0),
      chainBlocks: Number(archive?.chain_blocks ?? 0),
    },
    registry: {
      assets: Number(registry?.assets ?? 0),
      lastObservedAt: registry?.last_observed_at ? new Date(registry.last_observed_at).toISOString() : null,
      quotedHabitats: Number(registry?.quoted_habitats ?? 0),
    },
  };
}

export async function pruneEngineHistory() {
  const db = getD1();
  const now = Date.now();
  await db.batch([
    db.prepare("DELETE FROM robinhood_quotes WHERE observed_at < ?").bind(now - 30 * 24 * 60 * 60 * 1000),
    db.prepare("DELETE FROM collection_runs WHERE started_at < ?").bind(now - 90 * 24 * 60 * 60 * 1000),
    db.prepare("DELETE FROM engine_alerts WHERE resolved_at IS NOT NULL AND resolved_at < ?").bind(now - 30 * 24 * 60 * 60 * 1000),
    db.prepare("DELETE FROM cohort_members WHERE selected = 0 AND last_seen_at < ?").bind(now - 14 * 24 * 60 * 60 * 1000),
  ]);
}
