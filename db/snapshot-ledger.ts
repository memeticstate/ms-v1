import { getD1 } from "@/db";
import type { AffinitySnapshot, SnapshotEnvelope, SnapshotReconciliation } from "@/lib/affinity-model";
import type { ReconciliationRecord } from "@/lib/ingestion/robinhood-reconcile";
import type { ChainBlockDecision, SnapshotRecord } from "@/lib/interpretation/derive-chain-block";

type SnapshotRow = {
  id: string;
  observed_at: number;
  block_number: number;
  block_hash: string;
  payload_json: string;
  provenance_json: string;
  created_at: number;
};

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, item]) => `${JSON.stringify(key)}:${stableStringify(item)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

async function sha256(value: string) {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function recordSnapshot(
  envelope: SnapshotEnvelope,
  reconciliation: SnapshotReconciliation,
  records: ReconciliationRecord[],
  chainBlock?: ChainBlockDecision,
) {
  const db = getD1();
  const payloadJson = stableStringify(envelope.snapshot);
  const provenanceJson = stableStringify({
    generatedAt: envelope.meta.generatedAt,
    sourceObservedAt: envelope.meta.sourceObservedAt,
    sources: envelope.meta.sources,
    warnings: envelope.meta.warnings,
    reconciliation,
    runId: envelope.meta.runId,
    engineConfidence: envelope.meta.engineConfidence,
  });
  const id = await sha256(`${payloadJson}|${provenanceJson}`);
  const chainBlockId = chainBlock?.meaningful
    ? await sha256(`${chainBlock.previousSnapshotId ?? "genesis"}|${id}|${stableStringify(chainBlock.block)}`)
    : undefined;
  const statements = [
    db.prepare(`INSERT OR IGNORE INTO affinity_snapshots
      (id, observed_at, generated_at, chain_id, block_number, block_hash, reconciliation_status, payload_json, provenance_json)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .bind(
        id,
        new Date(envelope.snapshot.observedAt).getTime(),
        new Date(envelope.meta.generatedAt).getTime(),
        reconciliation.chainId,
        reconciliation.blockNumber,
        reconciliation.blockHash,
        reconciliation.status,
        payloadJson,
        provenanceJson,
      ),
    ...records.map((record) => db.prepare(`INSERT OR IGNORE INTO reconciliation_records
      (snapshot_id, species_id, contract_address, launch_tx_hash, launch_block_number, code_verified, launch_verified)
      VALUES (?, ?, ?, ?, ?, ?, ?)`)
      .bind(
        id,
        record.speciesId,
        record.contract,
        record.launchTxHash,
        record.launchBlockNumber,
        record.codeVerified ? 1 : 0,
        record.launchVerified ? 1 : 0,
      )),
    ...envelope.snapshot.species.map((species) => {
      const metrics = species.metrics;
      const liquidity = species.liquidityUsd ?? 0;
      const depth = species.totalDepthUsd ?? liquidity;
      const turnover = metrics?.turnover24h ?? (species.marketCapUsd > 0 ? species.observedVolumeUsd / species.marketCapUsd * 100 : 0);
      const depthRatio = metrics?.depthRatio ?? (species.marketCapUsd > 0 ? depth / species.marketCapUsd * 100 : 0);
      return db.prepare(`INSERT OR IGNORE INTO species_observations
        (snapshot_id, species_id, observed_at, protocol, contract_address, symbol, market_cap_usd,
         volume_24h_usd, liquidity_usd, total_depth_usd, trades_24h, change_24h, affinity_balance,
         market_vitality, market_stress, turnover_24h, depth_ratio)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .bind(
          id,
          species.id,
          new Date(envelope.snapshot.observedAt).getTime(),
          species.sourceProtocol,
          species.contract.toLowerCase(),
          species.symbol,
          species.marketCapUsd,
          species.observedVolumeUsd,
          liquidity,
          depth,
          species.trades24h ?? null,
          species.change24h,
          metrics?.affinityBalance ?? species.coherence,
          metrics?.marketVitality ?? species.vitality,
          metrics?.marketStress ?? species.stress,
          turnover,
          depthRatio,
        );
    }),
    ...envelope.snapshot.edges.map((edge) => db.prepare(`INSERT OR IGNORE INTO affinity_edge_observations
      (snapshot_id, species_id, habitat, observed_at, protocol, declared_weight, strength)
      VALUES (?, ?, ?, ?, ?, ?, ?)`)
      .bind(
        id,
        edge.speciesId,
        edge.habitat,
        new Date(envelope.snapshot.observedAt).getTime(),
        edge.sourceProtocol,
        edge.declaredWeight ?? null,
        edge.strength,
      )),
    ...(chainBlock?.meaningful && chainBlock.kind && chainBlockId
      ? [db.prepare(`INSERT OR IGNORE INTO chain_blocks
        (id, number, detected_at, snapshot_id, previous_snapshot_id, kind, significance, payload_json, provenance_json)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .bind(
          chainBlockId,
          chainBlock.block.number,
          new Date(envelope.snapshot.observedAt).getTime(),
          id,
          chainBlock.previousSnapshotId,
          chainBlock.kind,
          chainBlock.significance,
          stableStringify(chainBlock.block),
          stableStringify({ ...chainBlock.provenance, currentSnapshotId: id }),
        )]
      : []),
  ];
  await db.batch(statements);
  const count = await db.prepare("SELECT COUNT(*) AS total FROM affinity_snapshots").first<{ total: number }>();
  return {
    snapshotId: id,
    position: Number(count?.total ?? 1),
    recordedAt: envelope.meta.generatedAt,
    ...(chainBlockId ? { chainBlockId } : {}),
  };
}

export async function loadRecentVerifiedSnapshotRecords(limit = 13): Promise<SnapshotRecord[]> {
  const safeLimit = Math.max(1, Math.min(48, Math.trunc(limit)));
  const result = await getD1().prepare(`SELECT id, payload_json
    FROM affinity_snapshots
    WHERE reconciliation_status = 'verified'
    ORDER BY observed_at DESC
    LIMIT ?`).bind(safeLimit).all<Pick<SnapshotRow, "id" | "payload_json">>();
  return result.results.map((row) => ({ snapshotId: row.id, snapshot: JSON.parse(row.payload_json) as AffinitySnapshot }));
}

export async function loadLatestVerifiedSnapshotRecord(): Promise<SnapshotRecord | null> {
  const db = getD1();
  const row = await db.prepare(`SELECT id, payload_json
    FROM affinity_snapshots
    WHERE reconciliation_status = 'verified'
    ORDER BY observed_at DESC
    LIMIT 1`).first<Pick<SnapshotRow, "id" | "payload_json">>();
  if (!row) return null;
  return { snapshotId: row.id, snapshot: JSON.parse(row.payload_json) as AffinitySnapshot };
}

export async function loadLatestSnapshot(reason: string): Promise<SnapshotEnvelope | null> {
  const db = getD1();
  const row = await db.prepare(`SELECT id, observed_at, block_number, block_hash, payload_json, provenance_json, created_at
    FROM affinity_snapshots
    WHERE reconciliation_status = 'verified'
    ORDER BY observed_at DESC
    LIMIT 1`).first<SnapshotRow>();
  if (!row) return null;

  const snapshot = JSON.parse(row.payload_json) as AffinitySnapshot;
  const provenance = JSON.parse(row.provenance_json) as {
    generatedAt: string;
    sourceObservedAt?: string;
    sources: SnapshotEnvelope["meta"]["sources"];
    warnings: string[];
    reconciliation: SnapshotReconciliation;
  };
  const reconciliation: SnapshotReconciliation = {
    ...provenance.reconciliation,
    providerCount: provenance.reconciliation.providerCount ?? 1,
    quorum: provenance.reconciliation.quorum ?? 1,
    degraded: provenance.reconciliation.degraded ?? true,
  };
  const sourceObservedAt = provenance.sourceObservedAt;
  const isCurrent = sourceObservedAt
    ? Date.now() - new Date(sourceObservedAt).getTime() <= 10 * 60 * 1000
    : false;
  const count = await db.prepare("SELECT COUNT(*) AS total FROM affinity_snapshots").first<{ total: number }>();
  return {
    snapshot,
    meta: {
      mode: isCurrent ? "live" : "cached",
      generatedAt: new Date().toISOString(),
      sourceObservedAt,
      sources: isCurrent
        ? provenance.sources
        : provenance.sources.map((item) => ({ ...item, status: "stale" })),
      warnings: isCurrent ? [] : [`Serving durable verified history: ${reason}`],
      reconciliation,
      ledger: {
        snapshotId: row.id,
        position: Number(count?.total ?? 1),
        recordedAt: new Date(row.created_at * 1000).toISOString(),
      },
    },
  };
}

export async function listSnapshotHistory(limit = 24) {
  const db = getD1();
  const safeLimit = Math.max(1, Math.min(100, Math.trunc(limit)));
  const result = await db.prepare(`SELECT id, observed_at, block_number, block_hash, reconciliation_status, created_at
    FROM affinity_snapshots
    ORDER BY observed_at DESC
    LIMIT ?`).bind(safeLimit).all<{
      id: string;
      observed_at: number;
      block_number: number;
      block_hash: string;
      reconciliation_status: string;
      created_at: number;
    }>();
  return result.results.map((row) => ({
    snapshotId: row.id,
    observedAt: new Date(row.observed_at).toISOString(),
    recordedAt: new Date(row.created_at * 1000).toISOString(),
    blockNumber: row.block_number,
    blockHash: row.block_hash,
    status: row.reconciliation_status,
  }));
}

export async function listSpeciesHistory(speciesId: string, limit = 48) {
  const safeLimit = Math.max(2, Math.min(288, Math.trunc(limit)));
  const result = await getD1().prepare(`SELECT snapshot_id, observed_at, symbol, market_cap_usd, volume_24h_usd,
      liquidity_usd, total_depth_usd, trades_24h, change_24h, affinity_balance, market_vitality,
      market_stress, turnover_24h, depth_ratio
    FROM species_observations
    WHERE species_id = ?
    ORDER BY observed_at DESC
    LIMIT ?`).bind(speciesId, safeLimit).all<{
      snapshot_id: string; observed_at: number; symbol: string; market_cap_usd: number; volume_24h_usd: number;
      liquidity_usd: number; total_depth_usd: number; trades_24h: number | null; change_24h: number;
      affinity_balance: number; market_vitality: number; market_stress: number; turnover_24h: number; depth_ratio: number;
    }>();
  return result.results.reverse().map((row) => ({
    snapshotId: row.snapshot_id,
    observedAt: new Date(row.observed_at).toISOString(),
    symbol: row.symbol,
    marketCapUsd: row.market_cap_usd,
    volume24hUsd: row.volume_24h_usd,
    liquidityUsd: row.liquidity_usd,
    totalDepthUsd: row.total_depth_usd,
    trades24h: row.trades_24h,
    change24h: row.change_24h,
    affinityBalance: row.affinity_balance,
    marketVitality: row.market_vitality,
    marketStress: row.market_stress,
    turnover24h: row.turnover_24h,
    depthRatio: row.depth_ratio,
  }));
}

export async function pruneSnapshotHistory(retentionDays = 180) {
  const cutoff = Date.now() - Math.max(30, retentionDays) * 24 * 60 * 60 * 1000;
  await getD1().prepare("DELETE FROM affinity_snapshots WHERE observed_at < ?").bind(cutoff).run();
}
