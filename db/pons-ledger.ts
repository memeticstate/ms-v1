import { getD1 } from "@/db";
import {
  PONS_FINALITY_BLOCKS,
  PONS_PAIR_BY_ADDRESS,
  PONS_PAIR_BY_SYMBOL,
  PONS_V1_CURRENT_FACTORY,
  PONS_V1_CURRENT_START_BLOCK,
  PONS_V1_LEGACY_FACTORY,
  PONS_V1_LEGACY_START_BLOCK,
  PONS_V2_DEPLOYMENT_FLOOR,
  PONS_V2_FACTORY,
  shortAddress,
} from "@/lib/pons/constants";
import {
  decodeCurveTrade,
  decodeFactoryLog,
  eventId,
  hexInt,
  type RpcLog,
} from "@/lib/pons/decode";
import type {
  PonsActivityPoint,
  PonsLaunchView,
  PonsMemoryHorizon,
  PonsPairCohort,
  PonsStateResponse,
  PonsTapeEvent,
} from "@/lib/pons/model";
import { rpcLogTimestamp } from "@/lib/ingestion/pons-rpc";
import { getPonsProtocolHistory } from "@/db/pons-history-ledger";
import {
  classifyPonsSignal,
  DEFAULT_PONS_STATE_WINDOW,
  normalizePonsWindowBlocks,
  PONS_SIGNAL_WINDOW_BLOCKS,
  ponsMomentumPercent,
  ponsSignalConfidence,
  ponsSignalNote,
} from "@/lib/pons/signals";

const INDEX_ID = "pons-v2";
const LEASE_MS = 55 * 1000;
const MIN_INTERVAL_MS = 35 * 1000;
const MEMORY_HORIZONS = [
  { id: "8m", label: "8 minutes", minutes: 8, toleranceMinutes: 20 },
  { id: "1h", label: "1 hour", minutes: 60, toleranceMinutes: 120 },
  { id: "6h", label: "6 hours", minutes: 360, toleranceMinutes: 720 },
  { id: "24h", label: "24 hours", minutes: 1_440, toleranceMinutes: 2_160 },
  { id: "7d", label: "7 days", minutes: 10_080, toleranceMinutes: 12_960 },
] as const;

type IndexRow = {
  locked_until: number;
  initialized_at: number | null;
  live_next_block: number;
  backfill_next_block: number;
  latest_safe_block: number;
  latest_safe_hash: string | null;
  latest_seen_block: number;
  last_attempt_at: number | null;
  last_success_at: number | null;
  last_failure_at: number | null;
  last_error_code: string | null;
  consecutive_failures: number;
  last_record_count: number;
};

type PairRecord = { symbol: string; decimals: number };

function safeErrorCode(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 96) || "unknown";
}

async function ensureIndexState() {
  await getD1().prepare(`INSERT OR IGNORE INTO pons_index_state
    (id, locked_until, live_next_block, backfill_next_block, latest_safe_block, latest_seen_block,
     consecutive_failures, last_record_count)
    VALUES (?, 0, 0, 0, 0, 0, 0, 0)`).bind(INDEX_ID).run();
}

export async function loadPonsIndexState() {
  await ensureIndexState();
  return getD1().prepare(`SELECT locked_until, initialized_at, live_next_block, backfill_next_block,
      latest_safe_block, latest_safe_hash, latest_seen_block, last_attempt_at, last_success_at,
      last_failure_at, last_error_code, consecutive_failures, last_record_count
    FROM pons_index_state WHERE id = ?`).bind(INDEX_ID).first<IndexRow>();
}

export async function acquirePonsIndexLease(options: { force?: boolean; now?: number } = {}) {
  const now = options.now ?? Date.now();
  await ensureIndexState();
  const result = await getD1().prepare(`UPDATE pons_index_state
    SET locked_until = ?, last_attempt_at = ?
    WHERE id = ? AND locked_until <= ?
      AND (? = 1 OR last_success_at IS NULL OR last_success_at <= ?)`)
    .bind(now + LEASE_MS, now, INDEX_ID, now, options.force ? 1 : 0, now - MIN_INTERVAL_MS)
    .run();
  return Number(result.meta?.changes ?? 0) === 1;
}

export async function initializePonsIndex(headBlock: number, bootstrapBlocks = 10_000) {
  const state = await loadPonsIndexState();
  if (!state) throw new Error("pons_index_state_missing");
  if (state.initialized_at) return state;
  const safeHead = Math.max(PONS_V2_DEPLOYMENT_FLOOR, headBlock - PONS_FINALITY_BLOCKS);
  const liveNext = Math.max(PONS_V2_DEPLOYMENT_FLOOR, safeHead - bootstrapBlocks + 1);
  const now = Date.now();
  await getD1().prepare(`UPDATE pons_index_state SET initialized_at = ?, live_next_block = ?,
      backfill_next_block = ?, latest_seen_block = ? WHERE id = ?`)
    .bind(now, liveNext, PONS_V2_DEPLOYMENT_FLOOR, headBlock, INDEX_ID).run();
  return loadPonsIndexState();
}

export async function rewindPonsIndex(fromBlock: number) {
  const db = getD1();
  await db.batch([
    db.prepare("DELETE FROM pons_curve_trades WHERE block_number >= ?").bind(fromBlock),
    db.prepare("DELETE FROM pons_events WHERE block_number >= ?").bind(fromBlock),
    db.prepare("DELETE FROM pons_launches WHERE block_number >= ?").bind(fromBlock),
    db.prepare(`UPDATE pons_index_state SET live_next_block = ?, latest_safe_block = ?,
      latest_safe_hash = NULL WHERE id = ?`).bind(fromBlock, Math.max(0, fromBlock - 1), INDEX_ID),
  ]);
}

export async function clearPonsStagedRange(fromBlock: number) {
  const db = getD1();
  await db.batch([
    db.prepare("DELETE FROM pons_curve_trades WHERE block_number >= ?").bind(fromBlock),
    db.prepare("DELETE FROM pons_events WHERE block_number >= ?").bind(fromBlock),
    db.prepare("DELETE FROM pons_launches WHERE block_number >= ?").bind(fromBlock),
  ]);
}

async function runBatches(statements: D1PreparedStatement[], size = 75) {
  const db = getD1();
  for (let index = 0; index < statements.length; index += size) {
    await db.batch(statements.slice(index, index + size));
  }
}

async function pairRegistry() {
  const result = await getD1().prepare(`SELECT LOWER(contract_address) AS contract_address,
      token_symbol, COALESCE(token_decimals, 18) AS token_decimals
    FROM robinhood_assets WHERE chain_id = 4663 AND status = 'ASSET_STATUS_ACTIVE'`)
    .all<{ contract_address: string; token_symbol: string; token_decimals: number }>();
  const registry = new Map<string, PairRecord>();
  for (const pair of PONS_PAIR_BY_ADDRESS.values()) registry.set(pair.address, { symbol: pair.symbol, decimals: pair.decimals });
  for (const row of result.results) registry.set(row.contract_address, { symbol: row.token_symbol, decimals: row.token_decimals });
  return registry;
}

async function curveMap(addresses: string[]) {
  const map = new Map<string, string>();
  const unique = [...new Set(addresses.map((address) => address.toLowerCase()))];
  for (let index = 0; index < unique.length; index += 80) {
    const slice = unique.slice(index, index + 80);
    const placeholders = slice.map(() => "?").join(",");
    const result = await getD1().prepare(`SELECT curve_address, token_address FROM pons_launches
      WHERE curve_address IN (${placeholders})`).bind(...slice)
      .all<{ curve_address: string; token_address: string }>();
    for (const row of result.results) map.set(row.curve_address.toLowerCase(), row.token_address.toLowerCase());
  }
  return map;
}

export async function persistPonsLogs(input: {
  factoryLogs: RpcLog[];
  curveLogs: RpcLog[];
  fallbackTimestamp: number;
}) {
  const observedAt = Date.now();
  const registry = await pairRegistry();
  const launches = input.factoryLogs.flatMap((log) => {
    const decoded = decodeFactoryLog(log);
    return decoded?.type === "launch" ? [{ log, decoded }] : [];
  });
  const freshCurves = new Map(launches.map(({ decoded }) => [decoded.curveAddress, decoded.tokenAddress]));
  const existingCurves = await curveMap(input.curveLogs.map((log) => log.address));
  const curves = new Map([...existingCurves, ...freshCurves]);
  const statements: D1PreparedStatement[] = [];

  for (const { log, decoded } of launches) {
    const pair = registry.get(decoded.pairTokenAddress)
      ?? { symbol: `PAIR-${decoded.pairTokenAddress.slice(2, 6).toUpperCase()}`, decimals: 18 };
    statements.push(getD1().prepare(`INSERT OR IGNORE INTO pons_launches
      (token_address, curve_address, deployer_address, pair_token_address, pair_symbol, pair_decimals,
       launch_config_id, graduation_threshold_raw, block_number, block_hash, block_timestamp,
       tx_hash, log_index, metadata_status, observed_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?)`)
      .bind(
        decoded.tokenAddress, decoded.curveAddress, decoded.deployerAddress, decoded.pairTokenAddress,
        pair.symbol, pair.decimals, decoded.launchConfigId, decoded.graduationThresholdRaw,
        hexInt(log.blockNumber), log.blockHash.toLowerCase(), rpcLogTimestamp(log, input.fallbackTimestamp),
        log.transactionHash.toLowerCase(), hexInt(log.logIndex), observedAt,
      ));
  }

  let lifecycleEvents = 0;
  for (const log of input.factoryLogs) {
    const decoded = decodeFactoryLog(log);
    if (!decoded) continue;
    lifecycleEvents += 1;
    statements.push(getD1().prepare(`INSERT OR IGNORE INTO pons_events
      (id, event_type, token_address, emitter_address, block_number, block_hash, block_timestamp,
       tx_hash, log_index, data_json, observed_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .bind(
        eventId(log), decoded.type, decoded.tokenAddress, log.address.toLowerCase(), hexInt(log.blockNumber),
        log.blockHash.toLowerCase(), rpcLogTimestamp(log, input.fallbackTimestamp), log.transactionHash.toLowerCase(),
        hexInt(log.logIndex), JSON.stringify(decoded), observedAt,
      ));
  }

  let trades = 0;
  for (const log of input.curveLogs) {
    const decoded = decodeCurveTrade(log);
    if (!decoded) continue;
    const tokenAddress = curves.get(decoded.curveAddress);
    if (!tokenAddress) continue;
    trades += 1;
    statements.push(getD1().prepare(`INSERT OR IGNORE INTO pons_curve_trades
      (id, curve_address, token_address, side, actor_address, recipient_address, quote_amount_raw,
       token_amount_raw, fee_raw, tax_raw, block_number, block_hash, block_timestamp, tx_hash,
       log_index, observed_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .bind(
        eventId(log), decoded.curveAddress, tokenAddress, decoded.side, decoded.actorAddress,
        decoded.recipientAddress, decoded.quoteAmountRaw, decoded.tokenAmountRaw, decoded.feeRaw,
        decoded.taxRaw, hexInt(log.blockNumber), log.blockHash.toLowerCase(),
        rpcLogTimestamp(log, input.fallbackTimestamp), log.transactionHash.toLowerCase(),
        hexInt(log.logIndex), observedAt,
      ));
  }

  await runBatches(statements);
  return { launches: launches.length, lifecycleEvents, trades, statements: statements.length };
}

export async function pendingPonsMetadata(limit = 40) {
  const result = await getD1().prepare(`SELECT l.token_address, COUNT(t.id) AS observed_trades
    FROM pons_launches l LEFT JOIN pons_curve_trades t ON t.token_address = l.token_address
    WHERE (l.metadata_status = 'pending'
       OR (l.metadata_status = 'failed' AND COALESCE(l.metadata_updated_at, 0) < ?))
      AND l.block_number <= COALESCE((SELECT latest_safe_block FROM pons_index_state WHERE id = ?), 0)
    GROUP BY l.token_address
    ORDER BY observed_trades DESC, l.block_number DESC LIMIT ?`)
    .bind(Date.now() - 6 * 60 * 60 * 1000, INDEX_ID, limit)
    .all<{ token_address: string }>();
  return result.results.map((row) => ({ tokenAddress: row.token_address }));
}

export async function updatePonsMetadata(records: Array<{
  tokenAddress: string;
  symbol: string | null;
  name: string | null;
  ok: boolean;
}>) {
  if (!records.length) return;
  const now = Date.now();
  await runBatches(records.map((record) => getD1().prepare(`UPDATE pons_launches
    SET token_symbol = COALESCE(?, token_symbol), token_name = COALESCE(?, token_name),
        metadata_status = ?, metadata_updated_at = ? WHERE token_address = ?`)
    .bind(record.symbol, record.name, record.ok ? "ok" : "failed", now, record.tokenAddress)));
}

export async function markPonsIndexSuccess(input: {
  liveNextBlock: number;
  backfillNextBlock: number;
  latestSafeBlock: number;
  latestSafeHash: string;
  latestSeenBlock: number;
  recordCount: number;
}) {
  await getD1().prepare(`UPDATE pons_index_state SET locked_until = 0, live_next_block = ?,
      backfill_next_block = ?, latest_safe_block = ?, latest_safe_hash = ?, latest_seen_block = ?,
      last_success_at = ?, last_error_code = NULL, consecutive_failures = 0, last_record_count = ?
    WHERE id = ?`)
    .bind(
      input.liveNextBlock, input.backfillNextBlock, input.latestSafeBlock, input.latestSafeHash,
      input.latestSeenBlock, Date.now(), input.recordCount, INDEX_ID,
    ).run();
}

export async function markPonsIndexFailure(error: unknown) {
  const message = error instanceof Error ? error.message : "pons collection failed";
  await getD1().prepare(`UPDATE pons_index_state SET locked_until = 0, last_failure_at = ?,
      last_error_code = ?, consecutive_failures = consecutive_failures + 1 WHERE id = ?`)
    .bind(Date.now(), safeErrorCode(message), INDEX_ID).run();
}

export async function recordPonsActivitySnapshot(headBlock: number, state?: PonsStateResponse) {
  const resolvedState = state ?? await getPonsState();
  if (!resolvedState.summary.launches && !resolvedState.summary.trades) return null;
  const id = `${resolvedState.window.toBlock}:${resolvedState.generatedAt}`;
  await getD1().prepare(`INSERT OR IGNORE INTO pons_activity_snapshots
    (id, observed_at, from_block, to_block, head_block, launch_count, graduation_count,
     buy_count, sell_count, active_deployers, active_traders, payload_json)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .bind(
      id, Date.now(), resolvedState.window.fromBlock, resolvedState.window.toBlock, headBlock,
      resolvedState.summary.launches, resolvedState.summary.graduations,
      resolvedState.cohorts.reduce((sum, cohort) => sum + cohort.buys, 0),
      resolvedState.cohorts.reduce((sum, cohort) => sum + cohort.sells, 0),
      resolvedState.summary.uniqueDeployers, resolvedState.summary.uniqueTraders,
      JSON.stringify({ cohorts: resolvedState.cohorts.slice(0, 12), scoreVersion: resolvedState.methodology.scoreVersion }),
    ).run();
  return id;
}

export async function cachePonsState(state: PonsStateResponse) {
  await getD1().prepare(`INSERT INTO pons_state_cache
    (window_blocks, generated_at, indexed_block, payload_json) VALUES (?, ?, ?, ?)
    ON CONFLICT(window_blocks) DO UPDATE SET generated_at = excluded.generated_at,
      indexed_block = excluded.indexed_block, payload_json = excluded.payload_json`)
    .bind(state.window.blocks, Date.now(), state.index.latestIndexedBlock, JSON.stringify(state)).run();
}

export async function loadCachedPonsState(windowBlocks = DEFAULT_PONS_STATE_WINDOW) {
  const normalized = normalizePonsWindowBlocks(windowBlocks);
  const row = await getD1().prepare(`SELECT generated_at, payload_json FROM pons_state_cache
    WHERE window_blocks = ? LIMIT 1`).bind(normalized)
    .first<{ generated_at: number; payload_json: string }>();
  if (!row) return null;
  try {
    return JSON.parse(row.payload_json) as PonsStateResponse;
  } catch {
    return null;
  }
}

function pairPresentation(symbol: string, address: string) {
  const known = PONS_PAIR_BY_SYMBOL.get(symbol) ?? PONS_PAIR_BY_ADDRESS.get(address);
  return {
    color: known?.color ?? "#8993aa",
    kind: known?.kind ?? "unknown" as const,
  };
}

function clamp(value: number, minimum = 0, maximum = 100) {
  return Math.max(minimum, Math.min(maximum, value));
}

function isoSeconds(value: number) {
  return new Date(value * 1000).toISOString();
}

export async function getPonsState(requestedWindowBlocks = DEFAULT_PONS_STATE_WINDOW): Promise<PonsStateResponse> {
  const state = await loadPonsIndexState();
  const generatedAt = new Date().toISOString();
  const latestIndexedBlock = Number(state?.latest_safe_block ?? 0);
  const latestSeenBlock = Number(state?.latest_seen_block ?? 0);
  const windowBlocks = normalizePonsWindowBlocks(requestedWindowBlocks);
  const fromBlock = Math.max(PONS_V2_DEPLOYMENT_FLOOR, latestIndexedBlock - windowBlocks + 1);
  const recentFromBlock = Math.max(PONS_V2_DEPLOYMENT_FLOOR, latestIndexedBlock - PONS_SIGNAL_WINDOW_BLOCKS + 1);
  const previousToBlock = recentFromBlock - 1;
  const previousFromBlock = Math.max(PONS_V2_DEPLOYMENT_FLOOR, previousToBlock - PONS_SIGNAL_WINDOW_BLOCKS + 1);
  const db = getD1();
  const protocolHistoryPromise = getPonsProtocolHistory();
  const [
    deployerRows, tradeRows, graduationRows, topRows, tapeRows, activityRows,
    globalTradeRow, pulseRow, coverageRow, latestRunRow,
  ] = await Promise.all([
    db.prepare(`SELECT pair_symbol, pair_token_address, deployer_address, COUNT(*) AS launches
      FROM pons_launches WHERE block_number BETWEEN ? AND ?
      GROUP BY pair_symbol, pair_token_address, deployer_address`)
      .bind(fromBlock, latestIndexedBlock)
      .all<{ pair_symbol: string; pair_token_address: string; deployer_address: string; launches: number }>(),
    db.prepare(`SELECT l.pair_symbol, l.pair_token_address, COUNT(t.id) AS trades,
        COUNT(DISTINCT t.actor_address) AS unique_traders,
        SUM(CASE WHEN t.side = 'buy' THEN 1 ELSE 0 END) AS buys,
        SUM(CASE WHEN t.side = 'sell' THEN 1 ELSE 0 END) AS sells,
        SUM(CASE WHEN t.block_number >= ? THEN 1 ELSE 0 END) AS recent_trades,
        SUM(CASE WHEN t.block_number BETWEEN ? AND ? THEN 1 ELSE 0 END) AS previous_trades,
        COUNT(DISTINCT CASE WHEN t.block_number >= ? THEN t.actor_address END) AS recent_unique_traders,
        SUM(CASE WHEN t.block_number >= ? AND t.side = 'buy' THEN 1 ELSE 0 END) AS recent_buys,
        SUM(CASE WHEN t.block_number >= ? AND t.side = 'sell' THEN 1 ELSE 0 END) AS recent_sells
      FROM pons_curve_trades t JOIN pons_launches l ON l.token_address = t.token_address
      WHERE t.block_number BETWEEN ? AND ? GROUP BY l.pair_symbol, l.pair_token_address`)
      .bind(
        recentFromBlock, previousFromBlock, previousToBlock, recentFromBlock, recentFromBlock,
        recentFromBlock, fromBlock, latestIndexedBlock,
      )
      .all<{ pair_symbol: string; pair_token_address: string; trades: number; unique_traders: number;
        buys: number; sells: number; recent_trades: number; previous_trades: number;
        recent_unique_traders: number; recent_buys: number; recent_sells: number }>(),
    db.prepare(`SELECT l.pair_symbol, l.pair_token_address, COUNT(DISTINCT e.token_address) AS graduations
      FROM pons_events e JOIN pons_launches l ON l.token_address = e.token_address
      WHERE e.event_type = 'graduation' AND e.block_number BETWEEN ? AND ?
      GROUP BY l.pair_symbol, l.pair_token_address`)
      .bind(fromBlock, latestIndexedBlock)
      .all<{ pair_symbol: string; pair_token_address: string; graduations: number }>(),
    db.prepare(`WITH trade_metrics AS MATERIALIZED (
        SELECT token_address, COUNT(*) AS trades,
          COUNT(DISTINCT actor_address) AS unique_traders,
          SUM(CASE WHEN side = 'buy' THEN 1 ELSE 0 END) AS buys,
          SUM(CASE WHEN side = 'sell' THEN 1 ELSE 0 END) AS sells,
          SUM(CASE WHEN block_number >= ? THEN 1 ELSE 0 END) AS recent_trades,
          SUM(CASE WHEN block_number BETWEEN ? AND ? THEN 1 ELSE 0 END) AS previous_trades,
          COUNT(DISTINCT CASE WHEN block_number >= ? THEN actor_address END) AS recent_unique_traders,
          SUM(CASE WHEN block_number >= ? AND side = 'buy' THEN 1 ELSE 0 END) AS recent_buys,
          SUM(CASE WHEN block_number >= ? AND side = 'sell' THEN 1 ELSE 0 END) AS recent_sells
        FROM pons_curve_trades WHERE block_number BETWEEN ? AND ? GROUP BY token_address
      ), ranked AS MATERIALIZED (
        SELECT l.token_address, l.curve_address, l.deployer_address, l.pair_token_address,
          l.pair_symbol, l.token_name, l.token_symbol, l.block_number, l.block_timestamp, l.tx_hash,
          l.launch_config_id, l.graduation_threshold_raw,
          COALESCE(t.trades, 0) AS trades, COALESCE(t.unique_traders, 0) AS unique_traders,
          COALESCE(t.buys, 0) AS buys, COALESCE(t.sells, 0) AS sells,
          COALESCE(t.recent_trades, 0) AS recent_trades,
          COALESCE(t.previous_trades, 0) AS previous_trades,
          COALESCE(t.recent_unique_traders, 0) AS recent_unique_traders,
          COALESCE(t.recent_buys, 0) AS recent_buys,
          COALESCE(t.recent_sells, 0) AS recent_sells
        FROM pons_launches l LEFT JOIN trade_metrics t ON t.token_address = l.token_address
        WHERE l.block_number BETWEEN ? AND ? OR t.token_address IS NOT NULL
        ORDER BY recent_trades DESC, trades DESC, unique_traders DESC, l.block_number DESC LIMIT 120
      )
      SELECT r.*,
        CASE WHEN EXISTS(SELECT 1 FROM pons_events e WHERE e.token_address = r.token_address AND e.event_type = 'graduation' AND e.block_number <= ?) THEN 'graduated'
             WHEN EXISTS(SELECT 1 FROM pons_events e WHERE e.token_address = r.token_address AND e.event_type = 'sweep' AND e.block_number <= ?) THEN 'swept'
             ELSE 'bonding' END AS phase,
        (SELECT COUNT(*) FROM pons_launches d WHERE d.deployer_address = r.deployer_address AND d.block_number <= ?) AS deployer_launches,
        (SELECT COUNT(DISTINCT e2.token_address) FROM pons_events e2
          JOIN pons_launches d2 ON d2.token_address = e2.token_address
          WHERE d2.deployer_address = r.deployer_address AND e2.event_type = 'graduation' AND e2.block_number <= ?) AS deployer_graduations
      FROM ranked r
      ORDER BY recent_trades DESC, trades DESC, unique_traders DESC, block_number DESC`)
      .bind(
        recentFromBlock, previousFromBlock, previousToBlock, recentFromBlock, recentFromBlock,
        recentFromBlock, fromBlock, latestIndexedBlock, fromBlock, latestIndexedBlock,
        latestIndexedBlock, latestIndexedBlock, latestIndexedBlock, latestIndexedBlock,
      ).all<{
        token_address: string; curve_address: string; deployer_address: string; pair_token_address: string;
        pair_symbol: string; token_name: string | null; token_symbol: string | null; block_number: number;
        block_timestamp: number; tx_hash: string; launch_config_id: number; graduation_threshold_raw: string;
        trades: number; unique_traders: number; buys: number; sells: number; phase: "bonding" | "graduated" | "swept";
        recent_trades: number; previous_trades: number; recent_unique_traders: number;
        recent_buys: number; recent_sells: number;
        deployer_launches: number; deployer_graduations: number;
      }>(),
    db.prepare(`SELECT e.id, e.event_type, e.token_address, e.block_number, e.block_timestamp,
        e.tx_hash, e.data_json, l.token_symbol, l.pair_symbol
      FROM pons_events e LEFT JOIN pons_launches l ON l.token_address = e.token_address
      WHERE e.event_type IN ('launch', 'graduation', 'sweep', 'permanent-lock')
        AND e.block_number <= ?
      ORDER BY e.block_number DESC, e.log_index DESC LIMIT 80`)
      .bind(latestIndexedBlock)
      .all<{ id: string; event_type: PonsTapeEvent["eventType"]; token_address: string; block_number: number;
        block_timestamp: number; tx_hash: string; data_json: string; token_symbol: string | null; pair_symbol: string | null }>(),
    db.prepare(`SELECT observed_at, to_block, head_block, launch_count, graduation_count, buy_count, sell_count,
        active_deployers, active_traders FROM pons_activity_snapshots
      ORDER BY observed_at DESC LIMIT 24`)
      .all<{ observed_at: number; to_block: number; head_block: number; launch_count: number;
        graduation_count: number; buy_count: number; sell_count: number;
        active_deployers: number; active_traders: number }>(),
    db.prepare(`SELECT COUNT(DISTINCT actor_address) AS unique_traders
      FROM pons_curve_trades WHERE block_number BETWEEN ? AND ?`)
      .bind(fromBlock, latestIndexedBlock).first<{ unique_traders: number }>(),
    db.prepare(`SELECT
        (SELECT COUNT(*) FROM pons_launches WHERE block_number BETWEEN ? AND ?) AS current_launches,
        (SELECT COUNT(*) FROM pons_launches WHERE block_number BETWEEN ? AND ?) AS previous_launches,
        (SELECT COUNT(*) FROM pons_curve_trades WHERE block_number BETWEEN ? AND ?) AS current_trades,
        (SELECT COUNT(*) FROM pons_curve_trades WHERE block_number BETWEEN ? AND ?) AS previous_trades,
        (SELECT COUNT(DISTINCT actor_address) FROM pons_curve_trades WHERE block_number BETWEEN ? AND ?) AS current_traders,
        (SELECT COUNT(DISTINCT actor_address) FROM pons_curve_trades WHERE block_number BETWEEN ? AND ?) AS previous_traders,
        (SELECT COUNT(DISTINCT token_address) FROM pons_events WHERE event_type = 'graduation' AND block_number BETWEEN ? AND ?) AS current_graduations,
        (SELECT COUNT(DISTINCT token_address) FROM pons_events WHERE event_type = 'graduation' AND block_number BETWEEN ? AND ?) AS previous_graduations`)
      .bind(
        recentFromBlock, latestIndexedBlock, previousFromBlock, previousToBlock,
        recentFromBlock, latestIndexedBlock, previousFromBlock, previousToBlock,
        recentFromBlock, latestIndexedBlock, previousFromBlock, previousToBlock,
        recentFromBlock, latestIndexedBlock, previousFromBlock, previousToBlock,
      ).first<{
        current_launches: number; previous_launches: number; current_trades: number; previous_trades: number;
        current_traders: number; previous_traders: number; current_graduations: number; previous_graduations: number;
      }>(),
    db.prepare(`SELECT COUNT(*) AS total,
        SUM(CASE WHEN metadata_status = 'ok' THEN 1 ELSE 0 END) AS resolved,
        SUM(CASE WHEN metadata_status = 'pending' THEN 1 ELSE 0 END) AS pending,
        SUM(CASE WHEN metadata_status = 'failed' THEN 1 ELSE 0 END) AS failed
      FROM pons_launches WHERE block_number BETWEEN ? AND ?`)
      .bind(PONS_V2_DEPLOYMENT_FLOOR, latestIndexedBlock)
      .first<{ total: number; resolved: number; pending: number; failed: number }>(),
    db.prepare(`SELECT status, phase, started_at, completed_at, duration_ms, warning_count,
        error_code, metadata_json FROM collection_runs
      WHERE lane = 'pons-index' ORDER BY started_at DESC LIMIT 1`)
      .first<{ status: string; phase: string; started_at: number; completed_at: number | null;
        duration_ms: number | null; warning_count: number; error_code: string | null; metadata_json: string }>(),
  ]);

  const pairMap = new Map<string, {
    symbol: string; address: string; launches: number; deployers: number; topDeployer: number;
    trades: number; traders: number; buys: number; sells: number; graduations: number;
    recentTrades: number; previousTrades: number; recentTraders: number; recentBuys: number; recentSells: number;
  }>();
  const ensurePair = (symbol: string, address: string) => {
    const key = `${symbol}:${address}`;
    const current = pairMap.get(key) ?? {
      symbol, address, launches: 0, deployers: 0, topDeployer: 0, trades: 0, traders: 0,
      buys: 0, sells: 0, graduations: 0, recentTrades: 0, previousTrades: 0,
      recentTraders: 0, recentBuys: 0, recentSells: 0,
    };
    pairMap.set(key, current);
    return current;
  };
  for (const row of deployerRows.results) {
    const current = ensurePair(row.pair_symbol, row.pair_token_address);
    current.launches += Number(row.launches);
    current.deployers += 1;
    current.topDeployer = Math.max(current.topDeployer, Number(row.launches));
  }
  for (const row of tradeRows.results) {
    const current = ensurePair(row.pair_symbol, row.pair_token_address);
    current.trades = Number(row.trades);
    current.traders = Number(row.unique_traders);
    current.buys = Number(row.buys);
    current.sells = Number(row.sells);
    current.recentTrades = Number(row.recent_trades);
    current.previousTrades = Number(row.previous_trades);
    current.recentTraders = Number(row.recent_unique_traders);
    current.recentBuys = Number(row.recent_buys);
    current.recentSells = Number(row.recent_sells);
  }
  for (const row of graduationRows.results) {
    ensurePair(row.pair_symbol, row.pair_token_address).graduations = Number(row.graduations);
  }

  const maxima = [...pairMap.values()].reduce((result, pair) => ({
    launches: Math.max(result.launches, pair.launches),
    deployers: Math.max(result.deployers, pair.deployers),
    recentTrades: Math.max(result.recentTrades, pair.recentTrades),
    recentTraders: Math.max(result.recentTraders, pair.recentTraders),
    traders: Math.max(result.traders, pair.traders),
    graduations: Math.max(result.graduations, pair.graduations),
  }), { launches: 1, deployers: 1, recentTrades: 1, recentTraders: 1, traders: 1, graduations: 1 });

  const cohorts: PonsPairCohort[] = [...pairMap.values()].map((pair) => {
    const presentation = pairPresentation(pair.symbol, pair.address);
    const concentration = pair.launches ? pair.topDeployer / pair.launches * 100 : 0;
    const signal = classifyPonsSignal({ recent: pair.recentTrades, previous: pair.previousTrades, recentActors: pair.recentTraders });
    const score = 20 * Math.sqrt(pair.launches / maxima.launches)
      + 20 * Math.sqrt(pair.deployers / maxima.deployers)
      + 25 * Math.sqrt(pair.recentTrades / maxima.recentTrades)
      + 20 * Math.sqrt(pair.recentTraders / maxima.recentTraders)
      + 10 * Math.sqrt(pair.graduations / maxima.graduations)
      + 5 * Math.sqrt(pair.traders / maxima.traders)
      - Math.max(0, concentration - 20) * 0.45;
    return {
      symbol: pair.symbol,
      address: pair.address,
      ...presentation,
      launches: pair.launches,
      uniqueDeployers: pair.deployers,
      trades: pair.trades,
      uniqueTraders: pair.traders,
      buys: pair.buys,
      sells: pair.sells,
      graduations: pair.graduations,
      topDeployerShare: Math.round(concentration * 10) / 10,
      recentTrades: pair.recentTrades,
      previousTrades: pair.previousTrades,
      recentUniqueTraders: pair.recentTraders,
      momentumPercent: ponsMomentumPercent(pair.recentTrades, pair.previousTrades),
      buyShare: pair.recentTrades ? Math.round(pair.recentBuys / pair.recentTrades * 100) : 0,
      graduationRate: pair.launches ? Math.round(clamp(pair.graduations / pair.launches * 100)) : 0,
      signal,
      signalNote: ponsSignalNote({ signal, recent: pair.recentTrades, previous: pair.previousTrades, recentActors: pair.recentTraders }),
      attentionScore: Math.round(clamp(score)),
    };
  }).sort((left, right) => right.attentionScore - left.attentionScore || right.recentTrades - left.recentTrades);

  const launches: PonsLaunchView[] = topRows.results.map((row) => {
    const presentation = pairPresentation(row.pair_symbol, row.pair_token_address);
    const trades = Number(row.trades);
    const uniqueTraders = Number(row.unique_traders);
    const recentTrades = Number(row.recent_trades);
    const previousTrades = Number(row.previous_trades);
    const recentUniqueTraders = Number(row.recent_unique_traders);
    const recentBuys = Number(row.recent_buys);
    const recentSells = Number(row.recent_sells);
    const momentumPercent = ponsMomentumPercent(recentTrades, previousTrades);
    const signal = classifyPonsSignal({ recent: recentTrades, previous: previousTrades, recentActors: recentUniqueTraders });
    const recency = latestIndexedBlock > 0 ? clamp(12 - (latestIndexedBlock - row.block_number) / 7_000, 0, 12) : 0;
    const momentumBoost = momentumPercent === null
      ? (recentTrades > 0 ? 8 : 0)
      : clamp(momentumPercent / 8, -10, 12);
    const attentionScore = clamp(
      6 + Math.log2(trades + 1) * 6 + Math.sqrt(uniqueTraders) * 4
      + Math.log2(recentTrades + 1) * 11 + Math.sqrt(recentUniqueTraders) * 5
      + (row.phase === "graduated" ? 12 : row.phase === "swept" ? 7 : 0) + recency + momentumBoost,
    );
    return {
      tokenAddress: row.token_address,
      curveAddress: row.curve_address,
      deployerAddress: row.deployer_address,
      pairTokenAddress: row.pair_token_address,
      pairSymbol: row.pair_symbol,
      pairColor: presentation.color,
      name: row.token_name ?? `Launch ${shortAddress(row.token_address)}`,
      symbol: row.token_symbol ?? shortAddress(row.token_address).toUpperCase(),
      blockNumber: row.block_number,
      launchedAt: isoSeconds(row.block_timestamp),
      txHash: row.tx_hash,
      launchConfigId: row.launch_config_id,
      graduationThresholdRaw: row.graduation_threshold_raw,
      phase: row.phase,
      trades,
      buys: Number(row.buys),
      sells: Number(row.sells),
      uniqueTraders,
      recentTrades,
      previousTrades,
      recentUniqueTraders,
      recentBuys,
      recentSells,
      momentumPercent,
      buyShare: recentTrades ? Math.round(recentBuys / recentTrades * 100) : 0,
      signal,
      signalNote: ponsSignalNote({ signal, recent: recentTrades, previous: previousTrades, recentActors: recentUniqueTraders }),
      confidence: ponsSignalConfidence(recentTrades, recentUniqueTraders),
      flowQuality: trades ? Math.round(clamp(uniqueTraders / trades * 180)) : 0,
      attentionScore: Math.round(attentionScore),
      deployerLaunches: Number(row.deployer_launches),
      deployerGraduations: Number(row.deployer_graduations),
    };
  }).sort((left, right) => right.attentionScore - left.attentionScore || right.recentTrades - left.recentTrades || right.blockNumber - left.blockNumber);

  const tape: PonsTapeEvent[] = tapeRows.results.map((row) => {
    let data: Record<string, unknown> = {};
    try { data = JSON.parse(row.data_json) as Record<string, unknown>; } catch { data = {}; }
    const detail = row.event_type === "launch"
      ? `entered the ${row.pair_symbol ?? "unknown"} curve`
      : row.event_type === "graduation"
        ? `graduated with ${String(data.pairAmountRaw ?? "unknown")} raw quote units`
        : row.event_type === "sweep"
          ? "completed the curve sweep"
          : "locked graduation supply permanently";
    return {
      id: row.id,
      eventType: row.event_type,
      tokenAddress: row.token_address,
      tokenSymbol: row.token_symbol ?? shortAddress(row.token_address).toUpperCase(),
      pairSymbol: row.pair_symbol ?? "—",
      blockNumber: row.block_number,
      observedAt: isoSeconds(row.block_timestamp),
      txHash: row.tx_hash,
      detail,
    };
  });

  const activity: PonsActivityPoint[] = activityRows.results.reverse().map((row) => ({
    observedAt: new Date(row.observed_at).toISOString(),
    indexedBlock: Number(row.to_block),
    headBlock: Number(row.head_block),
    lagBlocks: Math.max(0, Number(row.head_block) - Number(row.to_block)),
    launches: Number(row.launch_count),
    graduations: Number(row.graduation_count),
    buys: Number(row.buy_count),
    sells: Number(row.sell_count),
    activeDeployers: Number(row.active_deployers),
    activeTraders: Number(row.active_traders),
  }));

  const totalLaunches = cohorts.reduce((sum, cohort) => sum + cohort.launches, 0);
  const totalGraduations = cohorts.reduce((sum, cohort) => sum + cohort.graduations, 0);
  const totalTrades = cohorts.reduce((sum, cohort) => sum + cohort.trades, 0);
  const uniqueDeployers = new Set(deployerRows.results.map((row) => row.deployer_address)).size;
  const uniqueTraders = Number(globalTradeRow?.unique_traders ?? 0);
  const protocolRecentTrades = Number(pulseRow?.current_trades ?? 0);
  const cohortRecentTrades = cohorts.reduce((sum, cohort) => sum + cohort.recentTrades, 0);
  const pulseReconciled = protocolRecentTrades === cohortRecentTrades;
  const liveLagBlocks = Math.max(0, latestSeenBlock - latestIndexedBlock);
  const velocityCandidates = activity.slice(-8);
  const velocityWindow = velocityCandidates.length ? [velocityCandidates.at(-1)!] : [];
  for (let index = velocityCandidates.length - 2; index >= 0; index -= 1) {
    const next = velocityWindow[0];
    const candidate = velocityCandidates[index];
    const gapMs = new Date(next.observedAt).getTime() - new Date(candidate.observedAt).getTime();
    if (gapMs > 10 * 60 * 1000) break;
    velocityWindow.unshift(candidate);
  }
  const velocityFirst = velocityWindow[0];
  const velocityLast = velocityWindow.at(-1);
  const velocityMinutes = velocityFirst && velocityLast
    ? (new Date(velocityLast.observedAt).getTime() - new Date(velocityFirst.observedAt).getTime()) / 60_000
    : 0;
  const roundVelocity = (value: number) => Math.round(value * 10) / 10;
  const indexedBlocksPerMinute = velocityMinutes > 0 && velocityFirst && velocityLast
    ? roundVelocity((velocityLast.indexedBlock - velocityFirst.indexedBlock) / velocityMinutes)
    : null;
  const chainBlocksPerMinute = velocityMinutes > 0 && velocityFirst && velocityLast
    ? roundVelocity((velocityLast.headBlock - velocityFirst.headBlock) / velocityMinutes)
    : null;
  const netCatchupPerMinute = indexedBlocksPerMinute !== null && chainBlocksPerMinute !== null
    ? roundVelocity(indexedBlocksPerMinute - chainBlocksPerMinute)
    : null;
  const estimatedCatchupMinutes = netCatchupPerMinute !== null && netCatchupPerMinute > 0
    ? Math.round(liveLagBlocks / netCatchupPerMinute)
    : null;
  const velocityTrend = netCatchupPerMinute === null
    ? "warming" as const
    : netCatchupPerMinute > 50
      ? "closing" as const
      : netCatchupPerMinute < -50
        ? "widening" as const
        : "flat" as const;
  const historicalProgress = latestSeenBlock > PONS_V2_DEPLOYMENT_FLOOR
    ? clamp(((Number(state?.backfill_next_block ?? PONS_V2_DEPLOYMENT_FLOOR) - PONS_V2_DEPLOYMENT_FLOOR)
      / (latestSeenBlock - PONS_V2_DEPLOYMENT_FLOOR)) * 100)
    : 0;
  const mode = !totalLaunches && !totalTrades
    ? "empty" as const
    : Number(state?.consecutive_failures ?? 0) > 0 || !pulseReconciled
      ? "degraded" as const
      : liveLagBlocks > 4_000
        ? "indexing" as const
        : "live" as const;
  const nvda = cohorts.find((cohort) => cohort.symbol === "NVDA") ?? null;
  const pulseMetric = (current: number | undefined, previous: number | undefined) => ({
    current: Number(current ?? 0),
    previous: Number(previous ?? 0),
    changePercent: ponsMomentumPercent(Number(current ?? 0), Number(previous ?? 0)),
  });
  const pulseLeader = [...launches]
    .filter((launch) => launch.recentTrades > 0)
    .sort((left, right) => right.recentTrades - left.recentTrades
      || right.recentUniqueTraders - left.recentUniqueTraders
      || right.attentionScore - left.attentionScore)[0] ?? null;
  let latestRunMetadata: Record<string, unknown> = {};
  try { latestRunMetadata = JSON.parse(latestRunRow?.metadata_json ?? "{}") as Record<string, unknown>; } catch { latestRunMetadata = {}; }
  const collectorStatus = latestRunRow && ["running", "succeeded", "failed"].includes(latestRunRow.status)
    ? latestRunRow.status as PonsStateResponse["collector"]["status"]
    : "idle";
  const strategy = latestRunMetadata.strategy === "balanced" || latestRunMetadata.strategy === "live-catchup"
    ? latestRunMetadata.strategy
    : null;
  const protocolHistory = await protocolHistoryPromise;
  const v1CurrentHistory = protocolHistory.generations.find((item) => item.id === "v1-current");
  const v1LegacyHistory = protocolHistory.generations.find((item) => item.id === "v1-legacy");
  const metadataTotal = Number(coverageRow?.total ?? 0);
  const metadataResolved = Number(coverageRow?.resolved ?? 0);
  const memoryRows = await Promise.all(MEMORY_HORIZONS.map((horizon) => db.prepare(`SELECT observed_at,
      launch_count, graduation_count, buy_count, sell_count, active_traders, payload_json
    FROM pons_activity_snapshots WHERE observed_at <= ? ORDER BY observed_at DESC LIMIT 1`)
    .bind(Date.now() - horizon.minutes * 60_000)
    .first<{ observed_at: number; launch_count: number; graduation_count: number; buy_count: number;
      sell_count: number; active_traders: number; payload_json: string }>()));
  const memoryMetric = (current: number, baseline: number | null) => ({
    current,
    baseline,
    changePercent: baseline === null ? null : ponsMomentumPercent(current, baseline),
    multiple: baseline === null || baseline <= 0 ? null : Math.round(current / baseline * 100) / 100,
  });
  const currentLeader = cohorts[0]?.symbol ?? null;
  const currentTrades = cohorts.reduce((sum, cohort) => sum + cohort.buys + cohort.sells, 0);
  const memoryHorizons: PonsMemoryHorizon[] = MEMORY_HORIZONS.map((horizon, index) => {
    const row = memoryRows[index];
    const elapsedMinutes = row ? Math.round((Date.now() - Number(row.observed_at)) / 60_000) : null;
    const ready = row !== null && elapsedMinutes !== null && elapsedMinutes <= horizon.toleranceMinutes;
    let baselineLeader: string | null = null;
    try {
      const payload = JSON.parse(row?.payload_json ?? "{}") as { cohorts?: Array<{ symbol?: string }> };
      baselineLeader = payload.cohorts?.[0]?.symbol ?? null;
    } catch { baselineLeader = null; }
    const baselineTrades = ready && row ? Number(row.buy_count) + Number(row.sell_count) : null;
    return {
      id: horizon.id,
      label: horizon.label,
      targetMinutes: horizon.minutes,
      elapsedMinutes: ready ? elapsedMinutes : null,
      status: ready ? "ready" : "warming",
      baselineObservedAt: ready && row ? new Date(Number(row.observed_at)).toISOString() : null,
      trades: memoryMetric(currentTrades, baselineTrades),
      activeTraders: memoryMetric(uniqueTraders, ready && row ? Number(row.active_traders) : null),
      launches: memoryMetric(totalLaunches, ready && row ? Number(row.launch_count) : null),
      graduations: memoryMetric(totalGraduations, ready && row ? Number(row.graduation_count) : null),
      leader: { current: currentLeader, baseline: ready ? baselineLeader : null, changed: ready && baselineLeader !== null && baselineLeader !== currentLeader },
    };
  });

  return {
    mode,
    generatedAt,
    window: {
      fromBlock,
      toBlock: latestIndexedBlock,
      blocks: windowBlocks,
      approximateHours: Math.round(windowBlocks / 36_000 * 10) / 10,
    },
    pulse: {
      windowBlocks: PONS_SIGNAL_WINDOW_BLOCKS,
      approximateMinutes: Math.round(PONS_SIGNAL_WINDOW_BLOCKS / 600 * 10) / 10,
      status: !state?.last_success_at ? "warming" : liveLagBlocks > 10_000 ? "delayed" : "verified",
      launches: pulseMetric(pulseRow?.current_launches, pulseRow?.previous_launches),
      trades: pulseMetric(pulseRow?.current_trades, pulseRow?.previous_trades),
      uniqueTraders: pulseMetric(pulseRow?.current_traders, pulseRow?.previous_traders),
      graduations: pulseMetric(pulseRow?.current_graduations, pulseRow?.previous_graduations),
      leader: pulseLeader ? {
        tokenAddress: pulseLeader.tokenAddress,
        tokenSymbol: pulseLeader.symbol,
        pairSymbol: pulseLeader.pairSymbol,
        recentTrades: pulseLeader.recentTrades,
      } : null,
    },
    integrity: {
      status: pulseReconciled ? "reconciled" : "mismatch",
      committedThroughBlock: latestIndexedBlock,
      protocolRecentTrades,
      cohortRecentTrades,
      pulseReconciled,
    },
    summary: {
      launches: totalLaunches,
      graduations: totalGraduations,
      trades: totalTrades,
      uniqueDeployers,
      uniqueTraders,
      stockPairs: cohorts.filter((cohort) => cohort.kind === "stock").length,
    },
    coverage: {
      metadataResolved,
      metadataPending: Number(coverageRow?.pending ?? 0),
      metadataFailed: Number(coverageRow?.failed ?? 0),
      metadataPercent: metadataTotal ? Math.round(metadataResolved / metadataTotal * 1_000) / 10 : 0,
      visibleLaunches: launches.length,
    },
    protocolCoverage: {
      canonicalGenerations: 3,
      deeplyIndexedGenerations: 1 + protocolHistory.generations.filter((item) => item.swapProgress >= 100).length,
      rankingScope: "PONS V2 ranks · V1 history reconstructed independently until swap coverage reaches 100%",
      generations: [
        {
          id: "v2",
          label: "V2 · Bonding curve",
          mechanism: "Curve → locked V4 pool",
          factory: PONS_V2_FACTORY,
          startBlock: PONS_V2_DEPLOYMENT_FLOOR,
          status: "deep",
          dataDepth: "Launches, curve trades, actors, graduations and locks",
          indexedThroughBlock: latestIndexedBlock || null,
          historicalProgress: Math.round(historicalProgress * 10) / 10,
          rankingEligible: true,
        },
        {
          id: "v1-current",
          label: "V1 · Current",
          mechanism: "Uniswap V3 from block one",
          factory: PONS_V1_CURRENT_FACTORY,
          startBlock: PONS_V1_CURRENT_START_BLOCK,
          status: v1CurrentHistory?.swapProgress === 100 ? "complete" : "indexing",
          dataDepth: `${v1CurrentHistory?.launches ?? 0} launches · ${v1CurrentHistory?.swaps ?? 0} V3 swaps reconstructed`,
          indexedThroughBlock: v1CurrentHistory?.swapIndexedThroughBlock ?? null,
          historicalProgress: Math.round((v1CurrentHistory?.swapProgress ?? 0) * 10) / 10,
          rankingEligible: false,
          launchesIndexed: v1CurrentHistory?.launches ?? 0,
          swapsIndexed: v1CurrentHistory?.swaps ?? 0,
          launchProgress: Math.round((v1CurrentHistory?.launchProgress ?? 0) * 10) / 10,
          swapProgress: Math.round((v1CurrentHistory?.swapProgress ?? 0) * 10) / 10,
        },
        {
          id: "v1-legacy",
          label: "V1 · Legacy",
          mechanism: "Uniswap V3 from block one",
          factory: PONS_V1_LEGACY_FACTORY,
          startBlock: PONS_V1_LEGACY_START_BLOCK,
          status: v1LegacyHistory?.launchProgress ? (v1LegacyHistory.swapProgress === 100 ? "complete" : "indexing") : "queued",
          dataDepth: `${v1LegacyHistory?.launches ?? 0} launches · ${v1LegacyHistory?.swaps ?? 0} V3 swaps reconstructed`,
          indexedThroughBlock: v1LegacyHistory?.swapIndexedThroughBlock ?? null,
          historicalProgress: Math.round((v1LegacyHistory?.swapProgress ?? 0) * 10) / 10,
          rankingEligible: false,
          launchesIndexed: v1LegacyHistory?.launches ?? 0,
          swapsIndexed: v1LegacyHistory?.swaps ?? 0,
          launchProgress: Math.round((v1LegacyHistory?.launchProgress ?? 0) * 10) / 10,
          swapProgress: Math.round((v1LegacyHistory?.swapProgress ?? 0) * 10) / 10,
        },
      ],
    },
    history: protocolHistory,
    collector: {
      status: collectorStatus,
      phase: latestRunRow?.phase ?? "idle",
      strategy,
      startedAt: latestRunRow?.started_at ? new Date(latestRunRow.started_at).toISOString() : null,
      completedAt: latestRunRow?.completed_at ? new Date(latestRunRow.completed_at).toISOString() : null,
      durationMs: latestRunRow?.duration_ms ?? null,
      warningCount: Number(latestRunRow?.warning_count ?? 0),
      errorCode: latestRunRow?.error_code ?? null,
      liveBlocksProcessed: Number(latestRunMetadata.liveBlocksProcessed ?? 0),
      historicalBlocksProcessed: Number(latestRunMetadata.historicalBlocksProcessed ?? 0),
      recordsProcessed: Number(latestRunMetadata.recordCount ?? 0),
      metadataResolved: Number(latestRunMetadata.metadataResolved ?? 0),
    },
    cohorts,
    launches,
    tape,
    activity,
    memory: {
      observationWindowBlocks: windowBlocks,
      currentThroughBlock: latestIndexedBlock,
      horizons: memoryHorizons,
    },
    flagship: {
      pair: "NVDA",
      thesis: "A PONS-wide attention engine with one legible reserve terrain: the stock token most closely associated with computation.",
      cohort: nvda,
    },
    index: {
      factory: PONS_V2_FACTORY,
      latestSeenBlock,
      latestIndexedBlock,
      liveLagBlocks,
      backfillNextBlock: Number(state?.backfill_next_block ?? PONS_V2_DEPLOYMENT_FLOOR),
      backfillFloor: PONS_V2_DEPLOYMENT_FLOOR,
      historicalProgress: Math.round(historicalProgress * 10) / 10,
      lastSuccessAt: state?.last_success_at ? new Date(state.last_success_at).toISOString() : null,
      consecutiveFailures: Number(state?.consecutive_failures ?? 0),
      source: "PONS V2 factory + per-launch curves · Robinhood Chain RPC",
      finalityBlocks: PONS_FINALITY_BLOCKS,
      velocity: {
        indexedBlocksPerMinute,
        chainBlocksPerMinute,
        netCatchupPerMinute,
        estimatedCatchupMinutes,
        trend: velocityTrend,
      },
    },
    methodology: {
      scoreVersion: "pons-attention-v3-memory",
      windowBlocks,
      caveats: [
        "Short-horizon signals compare two adjacent 5,000-block intervals; a forming signal means the prior interval had no trades.",
        "Launch velocity is separated from deployer breadth so repeated automated launches cannot dominate attention alone.",
        "Graduation records curve completion, not investment quality.",
        "Trade breadth counts distinct transaction actors observed on canonical PONS bonding curves.",
        "Attention scores rank observed activity inside the selected window and are not absolute valuations.",
        "State Memory compares the same rolling observation window now versus durable snapshots at each horizon; it does not imply price direction.",
      ],
    },
  };
}

export async function prunePonsObservations() {
  const db = getD1();
  const now = Date.now();
  await db.batch([
    db.prepare("DELETE FROM pons_activity_snapshots WHERE observed_at < ?").bind(now - 30 * 24 * 60 * 60 * 1000),
  ]);
}
