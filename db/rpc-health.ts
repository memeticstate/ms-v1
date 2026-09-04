import { getD1 } from "@/db";
import type { RpcProviderObservation } from "@/lib/affinity-model";

export async function recordRpcObservations(observations: RpcProviderObservation[]) {
  if (!observations.length) return;
  const db = getD1();
  await db.batch(observations.map((item) => db.prepare(`INSERT INTO rpc_provider_observations
    (observed_at, provider, status, latency_ms, block_number, block_hash, error_code)
    VALUES (?, ?, ?, ?, ?, ?, ?)`)
    .bind(
      new Date(item.observedAt).getTime(),
      item.provider,
      item.status,
      item.latencyMs,
      item.blockNumber ?? null,
      item.blockHash ?? null,
      item.errorCode ?? null,
    )));
  await db.prepare(`DELETE FROM rpc_provider_observations
    WHERE id NOT IN (
      SELECT id FROM rpc_provider_observations ORDER BY observed_at DESC LIMIT 5000
    )`).run();
}

export async function getRpcHealth() {
  const db = getD1();
  type HealthRow = {
    provider: string;
    status: RpcProviderObservation["status"];
    latency_ms: number;
    block_number: number | null;
    block_hash: string | null;
    error_code: string | null;
    observed_at: number;
  };
  const result = await db.prepare(`SELECT provider, status, latency_ms, block_number, block_hash, error_code, observed_at
    FROM rpc_provider_observations
    ORDER BY observed_at DESC
    LIMIT 250`).all<HealthRow>();
  const latest = new Map<string, HealthRow>();
  for (const row of result.results) if (!latest.has(row.provider)) latest.set(row.provider, row);
  return {
    providers: [...latest.values()].map((row: HealthRow) => ({
      provider: row.provider,
      status: row.status,
      latencyMs: row.latency_ms,
      blockNumber: row.block_number,
      blockHash: row.block_hash,
      errorCode: row.error_code,
      observedAt: new Date(row.observed_at).toISOString(),
    })),
    recentDisagreements: result.results.filter((row: HealthRow) => row.status === "disagreeing").length,
    recentFailures: result.results.filter((row: HealthRow) => row.status === "failed").length,
  };
}
