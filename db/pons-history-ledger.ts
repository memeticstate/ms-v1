import { getD1 } from "@/db";
import {
  PONS_FINALITY_BLOCKS,
  PONS_PAIR_BY_ADDRESS,
  PONS_V1_GENERATIONS,
  shortAddress,
  type PonsV1GenerationId,
} from "@/lib/pons/constants";
import {
  decodeV1Launch,
  decodeV3Swap,
  eventId,
  hexInt,
  type RpcLog,
} from "@/lib/pons/decode";
import { rpcLogTimestamp } from "@/lib/ingestion/pons-rpc";
import type { PonsHistoricalLaunch, PonsProtocolHistory } from "@/lib/pons/model";

const LEASE_MS = 55 * 1000;
const MIN_INTERVAL_MS = 25 * 1000;

type GenerationRow = {
  id: PonsV1GenerationId;
  factory_address: string;
  start_block: number;
  launch_next_block: number;
  swap_next_block: number;
  latest_seen_block: number;
  locked_until: number;
  last_attempt_at: number | null;
  last_success_at: number | null;
  last_failure_at: number | null;
  last_error_code: string | null;
  consecutive_failures: number;
  last_record_count: number;
};

function safeErrorCode(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 96) || "unknown";
}

async function ensureGeneration(generationId: PonsV1GenerationId) {
  const generation = PONS_V1_GENERATIONS[generationId];
  await getD1().prepare(`INSERT OR IGNORE INTO pons_generation_index_state
    (id, factory_address, start_block, launch_next_block, swap_next_block, latest_seen_block,
     locked_until, consecutive_failures, last_record_count)
    VALUES (?, ?, ?, ?, ?, 0, 0, 0, 0)`)
    .bind(generation.id, generation.factory, generation.startBlock, generation.startBlock, generation.startBlock)
    .run();
}

export async function loadPonsGenerationState(generationId: PonsV1GenerationId) {
  await ensureGeneration(generationId);
  return getD1().prepare(`SELECT id, factory_address, start_block, launch_next_block, swap_next_block,
      latest_seen_block, locked_until, last_attempt_at, last_success_at, last_failure_at,
      last_error_code, consecutive_failures, last_record_count
    FROM pons_generation_index_state WHERE id = ?`).bind(generationId).first<GenerationRow>();
}

export async function acquirePonsGenerationLease(generationId: PonsV1GenerationId, force = false) {
  const now = Date.now();
  await ensureGeneration(generationId);
  const result = await getD1().prepare(`UPDATE pons_generation_index_state
    SET locked_until = ?, last_attempt_at = ?
    WHERE id = ? AND locked_until <= ?
      AND (? = 1 OR last_success_at IS NULL OR last_success_at <= ?)`)
    .bind(now + LEASE_MS, now, generationId, now, force ? 1 : 0, now - MIN_INTERVAL_MS).run();
  return Number(result.meta?.changes ?? 0) === 1;
}

async function pairRegistry() {
  const result = await getD1().prepare(`SELECT LOWER(contract_address) AS contract_address,
      token_symbol FROM robinhood_assets WHERE chain_id = 4663 AND status = 'ASSET_STATUS_ACTIVE'`)
    .all<{ contract_address: string; token_symbol: string }>();
  const registry = new Map<string, string>();
  for (const pair of PONS_PAIR_BY_ADDRESS.values()) registry.set(pair.address, pair.symbol);
  for (const row of result.results) registry.set(row.contract_address, row.token_symbol);
  return registry;
}

async function runBatches(statements: D1PreparedStatement[], size = 75) {
  for (let index = 0; index < statements.length; index += size) {
    await getD1().batch(statements.slice(index, index + size));
  }
}

export async function persistPonsV1LaunchLogs(
  generationId: PonsV1GenerationId,
  logs: RpcLog[],
  fallbackTimestamp: number,
) {
  const generation = PONS_V1_GENERATIONS[generationId];
  const registry = await pairRegistry();
  const observedAt = Date.now();
  const statements = logs.flatMap((log) => {
    const decoded = decodeV1Launch(log);
    if (!decoded) return [];
    const pairSymbol = registry.get(decoded.pairTokenAddress)
      ?? `PAIR-${decoded.pairTokenAddress.slice(2, 6).toUpperCase()}`;
    return [getD1().prepare(`INSERT OR IGNORE INTO pons_v1_launches
      (token_address, generation, factory_address, deployer_address, dex_factory_address,
       pair_token_address, pair_symbol, pool_address, dex_id, launch_config_id, position_id,
       restrictions_end_block, initial_buy_amount_raw, block_number, block_hash, block_timestamp,
       tx_hash, log_index, metadata_status, observed_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?)`)
      .bind(
        decoded.tokenAddress, generationId, generation.factory, decoded.deployerAddress,
        decoded.dexFactoryAddress, decoded.pairTokenAddress, pairSymbol, decoded.poolAddress,
        decoded.dexId, decoded.launchConfigId, decoded.positionId, decoded.restrictionsEndBlock,
        decoded.initialBuyAmountRaw, hexInt(log.blockNumber), log.blockHash.toLowerCase(),
        rpcLogTimestamp(log, fallbackTimestamp), log.transactionHash.toLowerCase(),
        hexInt(log.logIndex), observedAt,
      )];
  });
  await runBatches(statements);
  return statements.length;
}

type PoolRow = { pool_address: string; token_address: string; pair_token_address: string };

async function poolRegistry(generationId: PonsV1GenerationId) {
  const rows = await getD1().prepare(`SELECT LOWER(pool_address) AS pool_address,
      LOWER(token_address) AS token_address, LOWER(pair_token_address) AS pair_token_address
    FROM pons_v1_launches WHERE generation = ?`).bind(generationId).all<PoolRow>();
  return new Map(rows.results.map((row) => [row.pool_address, row]));
}

export async function getPonsV1PoolAddresses(generationId: PonsV1GenerationId) {
  return [...(await poolRegistry(generationId)).keys()];
}

function absolute(value: string) {
  const parsed = BigInt(value);
  return (parsed < 0n ? -parsed : parsed).toString(10);
}

export async function persistPonsV1SwapLogs(
  generationId: PonsV1GenerationId,
  logs: RpcLog[],
  fallbackTimestamp: number,
) {
  const pools = await poolRegistry(generationId);
  const observedAt = Date.now();
  const statements = logs.flatMap((log) => {
    const pool = pools.get(log.address.toLowerCase());
    if (!pool) return [];
    const decoded = decodeV3Swap(log);
    if (!decoded) return [];
    const tokenIsZero = pool.token_address < pool.pair_token_address;
    const tokenDelta = tokenIsZero ? decoded.amount0Raw : decoded.amount1Raw;
    const quoteDelta = tokenIsZero ? decoded.amount1Raw : decoded.amount0Raw;
    const side = BigInt(tokenDelta) < 0n ? "buy" : "sell";
    return [getD1().prepare(`INSERT OR IGNORE INTO pons_v1_swaps
      (id, generation, pool_address, token_address, side, sender_address, recipient_address,
       amount0_raw, amount1_raw, token_amount_raw, quote_amount_raw, sqrt_price_x96,
       liquidity_raw, tick, block_number, block_hash, block_timestamp, tx_hash, log_index, observed_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .bind(
        eventId(log), generationId, decoded.poolAddress, pool.token_address, side,
        decoded.senderAddress, decoded.recipientAddress, decoded.amount0Raw, decoded.amount1Raw,
        absolute(tokenDelta), absolute(quoteDelta), decoded.sqrtPriceX96, decoded.liquidityRaw,
        decoded.tick, hexInt(log.blockNumber), log.blockHash.toLowerCase(),
        rpcLogTimestamp(log, fallbackTimestamp), log.transactionHash.toLowerCase(),
        hexInt(log.logIndex), observedAt,
      )];
  });
  await runBatches(statements);
  return statements.length;
}

export async function pendingPonsV1Metadata(generationId: PonsV1GenerationId, limit = 10) {
  const rows = await getD1().prepare(`SELECT token_address FROM pons_v1_launches
    WHERE generation = ? AND (metadata_status = 'pending'
      OR (metadata_status = 'failed' AND COALESCE(metadata_updated_at, 0) < ?))
    ORDER BY block_number DESC LIMIT ?`)
    .bind(generationId, Date.now() - 6 * 60 * 60 * 1000, limit)
    .all<{ token_address: string }>();
  return rows.results.map((row) => ({ tokenAddress: row.token_address }));
}

export async function updatePonsV1Metadata(records: Array<{
  tokenAddress: string; symbol: string | null; name: string | null; ok: boolean;
}>) {
  if (!records.length) return;
  const now = Date.now();
  await runBatches(records.map((record) => getD1().prepare(`UPDATE pons_v1_launches
    SET token_symbol = COALESCE(?, token_symbol), token_name = COALESCE(?, token_name),
      metadata_status = ?, metadata_updated_at = ? WHERE token_address = ?`)
    .bind(record.symbol, record.name, record.ok ? "ok" : "failed", now, record.tokenAddress)));
}

export async function markPonsGenerationSuccess(input: {
  generationId: PonsV1GenerationId;
  latestSeenBlock: number;
  launchNextBlock?: number;
  swapNextBlock?: number;
  recordCount: number;
}) {
  const state = await loadPonsGenerationState(input.generationId);
  if (!state) throw new Error("pons_generation_state_missing");
  await getD1().prepare(`UPDATE pons_generation_index_state SET locked_until = 0,
      launch_next_block = ?, swap_next_block = ?, latest_seen_block = ?, last_success_at = ?,
      last_error_code = NULL, consecutive_failures = 0, last_record_count = ? WHERE id = ?`)
    .bind(
      input.launchNextBlock ?? state.launch_next_block,
      input.swapNextBlock ?? state.swap_next_block,
      input.latestSeenBlock,
      Date.now(),
      input.recordCount,
      input.generationId,
    ).run();
}

export async function markPonsGenerationFailure(generationId: PonsV1GenerationId, error: unknown) {
  const message = error instanceof Error ? error.message : "pons history collection failed";
  await getD1().prepare(`UPDATE pons_generation_index_state SET locked_until = 0,
      last_failure_at = ?, last_error_code = ?, consecutive_failures = consecutive_failures + 1
    WHERE id = ?`).bind(Date.now(), safeErrorCode(message), generationId).run();
}

function progress(start: number, next: number, head: number) {
  const total = Math.max(1, head - start + 1);
  return Math.max(0, Math.min(100, ((Math.min(next, head + 1) - start) / total) * 100));
}

export async function getPonsProtocolHistory(limit = 30): Promise<PonsProtocolHistory> {
  await Promise.all((Object.keys(PONS_V1_GENERATIONS) as PonsV1GenerationId[]).map(ensureGeneration));
  const db = getD1();
  const [stateRows, countRows, recentRows] = await Promise.all([
    db.prepare(`SELECT id, factory_address, start_block, launch_next_block, swap_next_block,
        latest_seen_block, last_success_at, last_error_code, consecutive_failures
      FROM pons_generation_index_state ORDER BY id`).all<{
        id: PonsV1GenerationId; factory_address: string; start_block: number; launch_next_block: number;
        swap_next_block: number; latest_seen_block: number; last_success_at: number | null;
        last_error_code: string | null; consecutive_failures: number;
      }>(),
    db.prepare(`SELECT generation, COUNT(*) AS launches,
        (SELECT COUNT(*) FROM pons_v1_swaps s WHERE s.generation = l.generation) AS swaps
      FROM pons_v1_launches l GROUP BY generation`).all<{ generation: PonsV1GenerationId; launches: number; swaps: number }>(),
    db.prepare(`WITH recent_launches AS MATERIALIZED (
        SELECT generation, token_address, deployer_address, pair_token_address, pair_symbol,
          pool_address, token_name, token_symbol, block_number, block_timestamp, tx_hash
        FROM pons_v1_launches ORDER BY block_number DESC LIMIT ?
      )
      SELECT l.generation, l.token_address, l.deployer_address, l.pair_token_address,
        l.pair_symbol, l.pool_address, l.token_name, l.token_symbol, l.block_number,
        l.block_timestamp, l.tx_hash, COUNT(s.id) AS swaps,
        COUNT(DISTINCT s.sender_address) AS unique_traders,
        SUM(CASE WHEN s.side = 'buy' THEN 1 ELSE 0 END) AS buys,
        SUM(CASE WHEN s.side = 'sell' THEN 1 ELSE 0 END) AS sells
      FROM recent_launches l LEFT JOIN pons_v1_swaps s ON s.token_address = l.token_address
      GROUP BY l.token_address ORDER BY l.block_number DESC`).bind(limit).all<{
        generation: PonsV1GenerationId; token_address: string; deployer_address: string;
        pair_token_address: string; pair_symbol: string; pool_address: string;
        token_name: string | null; token_symbol: string | null; block_number: number;
        block_timestamp: number; tx_hash: string; swaps: number; unique_traders: number;
        buys: number; sells: number;
      }>(),
  ]);
  const counts = new Map(countRows.results.map((row) => [row.generation, row]));
  const generations = stateRows.results.map((row) => ({
    id: row.id,
    factory: row.factory_address,
    startBlock: row.start_block,
    latestSeenBlock: row.latest_seen_block,
    launchIndexedThroughBlock: Math.max(row.start_block - 1, row.launch_next_block - 1),
    swapIndexedThroughBlock: Math.max(row.start_block - 1, row.swap_next_block - 1),
    launchProgress: progress(row.start_block, row.launch_next_block, row.latest_seen_block),
    swapProgress: progress(row.start_block, row.swap_next_block, row.latest_seen_block),
    launches: Number(counts.get(row.id)?.launches ?? 0),
    swaps: Number(counts.get(row.id)?.swaps ?? 0),
    lastSuccessAt: row.last_success_at ? new Date(row.last_success_at).toISOString() : null,
    lastErrorCode: row.last_error_code,
    consecutiveFailures: Number(row.consecutive_failures),
  }));
  const recent: PonsHistoricalLaunch[] = recentRows.results.map((row) => ({
    generation: row.generation,
    mechanism: "Uniswap V3 from block one",
    tokenAddress: row.token_address,
    deployerAddress: row.deployer_address,
    pairTokenAddress: row.pair_token_address,
    pairSymbol: row.pair_symbol,
    venueAddress: row.pool_address,
    name: row.token_name ?? `Launch ${shortAddress(row.token_address)}`,
    symbol: row.token_symbol ?? shortAddress(row.token_address).toUpperCase(),
    blockNumber: row.block_number,
    launchedAt: new Date(row.block_timestamp * 1000).toISOString(),
    txHash: row.tx_hash,
    swaps: Number(row.swaps),
    buys: Number(row.buys ?? 0),
    sells: Number(row.sells ?? 0),
    uniqueTraders: Number(row.unique_traders),
  }));
  return {
    generations,
    launchCount: generations.reduce((sum, item) => sum + item.launches, 0),
    swapCount: generations.reduce((sum, item) => sum + item.swaps, 0),
    recent,
    finalityBlocks: PONS_FINALITY_BLOCKS,
  };
}
