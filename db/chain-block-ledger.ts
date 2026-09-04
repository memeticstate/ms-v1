import { getD1 } from "@/db";
import type { ChainBlock } from "@/lib/affinity-model";
import type { ChainBlockKind, ChainBlockProvenance } from "@/lib/interpretation/derive-chain-block";

type ChainBlockRow = {
  id: string;
  number: number;
  detected_at: number;
  snapshot_id: string;
  previous_snapshot_id: string | null;
  kind: ChainBlockKind;
  significance: number;
  payload_json: string;
  provenance_json: string;
  created_at: number;
};

export async function loadLatestChainBlock(): Promise<ChainBlock | null> {
  const db = getD1();
  const row = await db.prepare(`SELECT payload_json
    FROM chain_blocks
    ORDER BY number DESC
    LIMIT 1`).first<{ payload_json: string }>();
  return row ? JSON.parse(row.payload_json) as ChainBlock : null;
}

export async function listChainBlocks(limit = 24) {
  const db = getD1();
  const safeLimit = Math.max(1, Math.min(100, Math.trunc(limit)));
  const result = await db.prepare(`SELECT id, number, detected_at, snapshot_id, previous_snapshot_id,
      kind, significance, payload_json, provenance_json, created_at
    FROM chain_blocks
    ORDER BY number DESC
    LIMIT ?`).bind(safeLimit).all<ChainBlockRow>();

  return result.results.map((row: ChainBlockRow) => ({
    chainBlockId: row.id,
    number: row.number,
    detectedAt: new Date(row.detected_at).toISOString(),
    snapshotId: row.snapshot_id,
    previousSnapshotId: row.previous_snapshot_id,
    kind: row.kind,
    significance: row.significance,
    block: JSON.parse(row.payload_json) as ChainBlock,
    provenance: JSON.parse(row.provenance_json) as ChainBlockProvenance & { currentSnapshotId: string },
    recordedAt: new Date(row.created_at * 1000).toISOString(),
  }));
}
