import { getD1 } from "@/db";

type SpeciesObservationRow = {
  snapshot_id: string;
  species_id: string;
  observed_at: number;
  market_cap_usd: number;
  volume_24h_usd: number;
  liquidity_usd: number;
  total_depth_usd: number;
  trades_24h: number | null;
  change_24h: number;
  affinity_balance: number;
  market_vitality: number;
  market_stress: number;
  turnover_24h: number;
  depth_ratio: number;
};

export async function listSpeciesHistory(speciesId: string, limit = 72) {
  const db = getD1();
  const safeLimit = Math.max(2, Math.min(288, Math.trunc(limit)));
  const result = await db.prepare(`SELECT snapshot_id, species_id, observed_at, market_cap_usd,
      volume_24h_usd, liquidity_usd, total_depth_usd, trades_24h, change_24h,
      affinity_balance, market_vitality, market_stress, turnover_24h, depth_ratio
    FROM species_observations
    WHERE species_id = ?
    ORDER BY observed_at DESC
    LIMIT ?`).bind(speciesId, safeLimit).all<SpeciesObservationRow>();

  return result.results.reverse().map((row: SpeciesObservationRow) => ({
    snapshotId: row.snapshot_id,
    speciesId: row.species_id,
    observedAt: new Date(row.observed_at).toISOString(),
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
