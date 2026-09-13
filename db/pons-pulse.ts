import { getD1 } from "@/db";
import { PONS_V2_DEPLOYMENT_FLOOR } from "@/lib/pons/constants";
import { PONS_SIGNAL_WINDOW_BLOCKS } from "@/lib/pons/signals";
import type { PulseEvidenceResponse, PulseEvidenceRow, PulseMetricKey } from "@/lib/pons/pulse-evidence";

// Use the same fixed interval as the displayed protocol pulse, regardless of research filters.
export async function getPulseEvidence(metric: PulseMetricKey, toBlock: number, offset = 0): Promise<PulseEvidenceResponse> {
  const db = getD1();
  const fromBlock = Math.max(PONS_V2_DEPLOYMENT_FLOOR, toBlock - PONS_SIGNAL_WINDOW_BLOCKS + 1);
  const limit = 25;
  const bounds = [fromBlock, toBlock];
  const query = metric === "actors" ? {
    count: "SELECT COUNT(DISTINCT actor_address) AS total FROM pons_curve_trades WHERE block_number BETWEEN ? AND ?",
    rows: `SELECT actor_address AS id, actor_address AS address, NULL AS symbol, NULL AS pair,
      MAX(block_number) AS block, MAX(block_timestamp) AS timestamp, NULL AS txHash,
      'actor' AS action, COUNT(*) AS trades, COUNT(DISTINCT token_address) AS tokens
      FROM pons_curve_trades WHERE block_number BETWEEN ? AND ? GROUP BY actor_address
      ORDER BY trades DESC, address ASC LIMIT ? OFFSET ?`,
  } : metric === "trades" ? {
    count: "SELECT COUNT(*) AS total FROM pons_curve_trades WHERE block_number BETWEEN ? AND ?",
    rows: `SELECT t.id, t.token_address AS address, l.token_symbol AS symbol, l.pair_symbol AS pair,
      t.block_number AS block, t.block_timestamp AS timestamp, t.tx_hash AS txHash,
      t.side AS action, NULL AS trades, NULL AS tokens
      FROM pons_curve_trades t LEFT JOIN pons_launches l ON l.token_address = t.token_address
      WHERE t.block_number BETWEEN ? AND ? ORDER BY t.block_number DESC, t.id DESC LIMIT ? OFFSET ?`,
  } : metric === "launches" ? {
    count: "SELECT COUNT(*) AS total FROM pons_launches WHERE block_number BETWEEN ? AND ?",
    rows: `SELECT token_address AS id, token_address AS address, token_symbol AS symbol, pair_symbol AS pair,
      block_number AS block, block_timestamp AS timestamp, tx_hash AS txHash,
      'launch' AS action, NULL AS trades, NULL AS tokens FROM pons_launches
      WHERE block_number BETWEEN ? AND ? ORDER BY block_number DESC, token_address DESC LIMIT ? OFFSET ?`,
  } : {
    count: "SELECT COUNT(DISTINCT token_address) AS total FROM pons_events WHERE event_type = 'graduation' AND block_number BETWEEN ? AND ?",
    rows: `SELECT e.id, e.token_address AS address, l.token_symbol AS symbol, l.pair_symbol AS pair,
      e.block_number AS block, e.block_timestamp AS timestamp, e.tx_hash AS txHash,
      'graduation' AS action, NULL AS trades, NULL AS tokens
      FROM pons_events e LEFT JOIN pons_launches l ON l.token_address = e.token_address
      WHERE e.event_type = 'graduation' AND e.block_number BETWEEN ? AND ?
      AND e.id = (SELECT g.id FROM pons_events g WHERE g.token_address = e.token_address
        AND g.event_type = 'graduation' AND g.block_number BETWEEN ? AND ?
        ORDER BY g.block_number DESC, g.id DESC LIMIT 1)
      ORDER BY e.block_number DESC, e.id DESC LIMIT ? OFFSET ?`,
  };
  const [count, rows] = await Promise.all([
    db.prepare(query.count).bind(...bounds).first<{ total: number }>(),
    db.prepare(query.rows).bind(...bounds, ...(metric === "graduations" ? bounds : []), limit, offset).all<PulseEvidenceRow>(),
  ]);
  const total = Number(count?.total ?? 0);
  return { metric, fromBlock, toBlock, total, offset, hasMore: offset + rows.results.length < total, rows: rows.results };
}
