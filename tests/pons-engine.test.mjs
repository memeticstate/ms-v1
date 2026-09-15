import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test, { after } from "node:test";
import { fileURLToPath } from "node:url";

import { createServer } from "vite";

const root = fileURLToPath(new URL("..", import.meta.url));
const vite = await createServer({
  appType: "custom",
  configFile: false,
  root,
  resolve: { alias: { "@": root } },
  server: { middlewareMode: true, hmr: { port: 24682 } },
});

after(async () => {
  await vite.close();
});

const { decodeFactoryLog, decodeCurveTrade, decodeV1Launch, decodeV3Swap } = await vite.ssrLoadModule("/lib/pons/decode.ts");
const { PONS_TOPICS, PONS_V2_FACTORY } = await vite.ssrLoadModule("/lib/pons/constants.ts");
const { classifyPonsSignal, normalizePonsWindowBlocks, ponsMomentumPercent, ponsSignalConfidence } =
  await vite.ssrLoadModule("/lib/pons/signals.ts");
const { assessRobinhoodRpcQuorum } = await vite.ssrLoadModule("/lib/ingestion/rpc-quorum.ts");
const { ponsCollectionBudget, PONS_MAX_BLOCKS_PER_RUN } = await vite.ssrLoadModule("/lib/pons/budget.ts");
const { isRetryablePonsRpcError, ponsLogRangeLimit } = await vite.ssrLoadModule("/lib/ingestion/pons-rpc.ts");
const { assessLaunch, currentPonsEvidence } = await vite.ssrLoadModule("/lib/pons/research.ts");
const { rpcEnvelopes } = await vite.ssrLoadModule("/lib/ingestion/rpc-transport.ts");

const now = Date.parse("2026-09-07T17:00:00Z");
const viable = { phase: "bonding", recentTrades: 40, previousTrades: 20, recentUniqueTraders: 15,
  previousUniqueTraders: 10, recentBuys: 30, recentSells: 10, netQuoteFlow: 100,
  lastTradeAt: new Date(now - 30_000).toISOString(), currentEvidence: {
    observedAt: new Date(now - 30_000).toISOString(), meaningfulHolders: 12, largestWalletSharePercent: 2,
    reserveSharePercent: 50, holdersComplete: false, holderSampleSize: 24,
  } };

test("historical Robinhouse and Verse activity never creates a current score", () => {
  for (const [recentTrades, previousTrades, recentUniqueTraders] of [[297, 0, 23], [278, 114, 20]]) {
    const result = assessLaunch({ ...viable, recentTrades, previousTrades, recentUniqueTraders }, false, now);
    assert.equal(result.signal, "historical"); assert.equal(result.score, null); assert.equal(result.eligible, false);
    assert.doesNotMatch(result.next, /save this launch/i);
  }
});
test("depleted reserves and graduated curve records cannot enter discovery", () => {
  assert.equal(assessLaunch({ ...viable, currentEvidence: { ...viable.currentEvidence, reserveSharePercent: 99.97 } }, true, now).signal, "inactive");
  assert.equal(assessLaunch({ ...viable, currentEvidence: { ...viable.currentEvidence, reserveSharePercent: 99.97 } }, false, now).signal, "inactive");
  assert.equal(assessLaunch({ ...viable, phase: "graduated" }, true, now).score, null);
});
test("drawdown, selling, inactivity, and missing holder evidence withhold scores", () => {
  for (const changes of [{ peakDrawdownPercent: 90 }, { netQuoteFlow: -10, recentSells: 35, recentBuys: 5 },
    { lastTradeAt: new Date(now - 3600_000).toISOString() }, { currentEvidence: null }, { previousTrades: 0 }]) {
    assert.equal(assessLaunch({ ...viable, ...changes }, true, now).eligible, false);
  }
});
test("verified returning participation re-enters without lifetime or graduation bonuses", () => {
  const reading = assessLaunch(viable, true, now);
  assert.equal(reading.eligible, true); assert.equal(reading.signal, "surging"); assert.ok(reading.score > 0 && reading.score < 100);
  assert.equal(assessLaunch({ ...viable, trades: 1e9, deployerGraduations: 1e9 }, true, now).score, reading.score);
});
test("fresh collector timestamps cannot disguise an old chain cursor", () => {
  const state = { mode: "live", generatedAt: new Date(now).toISOString(), collector: { status: "succeeded" },
    integrity: { pulseReconciled: true }, index: { consecutiveFailures: 0, liveLagBlocks: 3_104_761, lastSuccessAt: new Date(now).toISOString() } };
  assert.equal(currentPonsEvidence(state, now), false);
  assert.equal(currentPonsEvidence({ ...state, index: { ...state.index, liveLagBlocks: 10 } }, now), true);
  assert.equal(currentPonsEvidence({ ...state, index: { ...state.index, liveLagBlocks: 10 } }, now + 180_000), true);
  assert.equal(currentPonsEvidence({ ...state, index: { ...state.index, liveLagBlocks: 10 } }, now + 241_000), false);
});
test("RPC transport negotiates unsupported batches without changing request IDs", async () => {
  const original = globalThis.fetch; let calls = 0;
  globalThis.fetch = async (_url, init) => {
    calls++; const request = JSON.parse(init.body);
    return Response.json(Array.isArray(request) ? { error: { code: -32600, message: "Batch requests are not supported" } } : { id: request.id, result: "0x1" });
  };
  try {
    const result = await rpcEnvelopes("https://rpc.example.test", [1, 2].map((id) => ({ jsonrpc: "2.0", id, method: "eth_blockNumber", params: [] })));
    assert.deepEqual(result.map((r) => r.id), [1, 2]); assert.equal(calls, 3);
  } finally { globalThis.fetch = original; }
});

function word(value) {
  return value.replace(/^0x/, "").padStart(64, "0");
}

function signedWord(value) {
  const normalized = value < 0n ? (1n << 256n) + value : value;
  return normalized.toString(16).padStart(64, "0");
}

function topicAddress(address) {
  return `0x${word(address)}`;
}

const baseLog = {
  address: PONS_V2_FACTORY,
  blockHash: `0x${"1".repeat(64)}`,
  blockNumber: "0x2faf08d",
  blockTimestamp: "0x6a941e26",
  logIndex: "0x54",
  removed: false,
  transactionHash: `0x${"2".repeat(64)}`,
};

test("decodes the canonical V2 launch identity and quote terrain", () => {
  const token = "0x1111111111111111111111111111111111111111";
  const curve = "0x2222222222222222222222222222222222222222";
  const deployer = "0x3333333333333333333333333333333333333333";
  const nvda = "0xd0601ce157db5bdc3162bbac2a2c8af5320d9eec";
  const decoded = decodeFactoryLog({
    ...baseLog,
    topics: [PONS_TOPICS.launch, topicAddress(token), topicAddress(curve), topicAddress(deployer)],
    data: `0x${word(nvda)}${word("0x3")}${word("0x1234")}`,
  });

  assert.deepEqual(decoded, {
    type: "launch",
    tokenAddress: token,
    curveAddress: curve,
    deployerAddress: deployer,
    pairTokenAddress: nvda,
    launchConfigId: 3,
    graduationThresholdRaw: "4660",
  });
});

test("decodes buy flows without converting lossless uint256 evidence to floats", () => {
  const curve = "0x2222222222222222222222222222222222222222";
  const buyer = "0x4444444444444444444444444444444444444444";
  const recipient = "0x5555555555555555555555555555555555555555";
  const decoded = decodeCurveTrade({
    ...baseLog,
    address: curve,
    topics: [PONS_TOPICS.curveBuy, topicAddress(buyer), topicAddress(recipient)],
    data: `0x${word("0xde0b6b3a7640000")}${word("0x56bc75e2d63100000")}${word("0x64")}${word("0x0")}`,
  });

  assert.equal(decoded.side, "buy");
  assert.equal(decoded.curveAddress, curve);
  assert.equal(decoded.actorAddress, buyer);
  assert.equal(decoded.quoteAmountRaw, "1000000000000000000");
  assert.equal(decoded.tokenAmountRaw, "100000000000000000000");
  assert.equal(decoded.feeRaw, "100");
});

test("decodes canonical V1 launches and lossless Uniswap V3 swap evidence", () => {
  const token = "0x1111111111111111111111111111111111111111";
  const deployer = "0x2222222222222222222222222222222222222222";
  const dexFactory = "0x3333333333333333333333333333333333333333";
  const quote = "0xd0601ce157db5bdc3162bbac2a2c8af5320d9eec";
  const pool = "0x4444444444444444444444444444444444444444";
  const launch = decodeV1Launch({
    ...baseLog,
    topics: [PONS_TOPICS.v1Launch, topicAddress(token), topicAddress(deployer), topicAddress(dexFactory)],
    data: `0x${word(quote)}${word(pool)}${word("0x1")}${word("0x2")}${word("0x3")}${word("0x4")}${word("0x5")}`,
  });
  assert.equal(launch.tokenAddress, token);
  assert.equal(launch.poolAddress, pool);
  assert.equal(launch.initialBuyAmountRaw, "5");

  const swap = decodeV3Swap({
    ...baseLog,
    address: pool,
    topics: [PONS_TOPICS.v3Swap, topicAddress(deployer), topicAddress(token)],
    data: `0x${signedWord(-25n)}${signedWord(10n)}${word("0x100")}${word("0x200")}${signedWord(-7n)}`,
  });
  assert.equal(swap.amount0Raw, "-25");
  assert.equal(swap.amount1Raw, "10");
  assert.equal(swap.tick, -7);
});

test("indexes PONS from canonical logs with finality, reorg rewind, and independent backfill", async () => {
  const [indexer, rpc, ledger] = await Promise.all([
    readFile(new URL("../lib/ingestion/pons-live.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/ingestion/pons-rpc.ts", import.meta.url), "utf8"),
    readFile(new URL("../db/pons-ledger.ts", import.meta.url), "utf8"),
  ]);
  assert.match(indexer, /PONS_FINALITY_BLOCKS/);
  assert.match(indexer, /reorg-check/);
  assert.match(indexer, /rewindPonsIndex/);
  assert.match(indexer, /clearPonsStagedRange/);
  assert.match(indexer, /historical-backfill/);
  assert.match(indexer, /historicalErrorCode/);
  assert.match(indexer, /historyDeadline/);
  assert.match(indexer, /metadataErrorCode/);
  assert.match(rpc, /eth_getLogs/);
  assert.match(rpc, /PONS_V2_FACTORY/);
  assert.match(ledger, /Launch velocity is separated from deployer breadth/);
  assert.match(ledger, /t\.block_number BETWEEN \? AND \?/);
  assert.match(ledger, /e\.block_number <= \?/);
  assert.doesNotMatch(`${indexer}\n${rpc}`, /api\.pons|ponsfamily\.com\/api/i);
});

test("keeps PONS collection inside the worker runtime while prioritizing the live edge", () => {
  const catchup = ponsCollectionBudget(10_000);
  const severeCatchup = ponsCollectionBudget(250_000);
  const nearHead = ponsCollectionBudget(2_000);
  assert.deepEqual(catchup, { strategy: "live-catchup", liveBlocks: 2_000, backfillBlocks: 0, metadataLimit: 2 });
  assert.deepEqual(severeCatchup, { strategy: "live-catchup", liveBlocks: 2_000, backfillBlocks: 0, metadataLimit: 2 });
  assert.deepEqual(nearHead, { strategy: "balanced", liveBlocks: 1_600, backfillBlocks: 400, metadataLimit: 5 });
  assert.equal(catchup.liveBlocks + catchup.backfillBlocks, PONS_MAX_BLOCKS_PER_RUN);
  assert.equal(severeCatchup.liveBlocks + severeCatchup.backfillBlocks, PONS_MAX_BLOCKS_PER_RUN);
  assert.equal(nearHead.liveBlocks + nearHead.backfillBlocks, PONS_MAX_BLOCKS_PER_RUN);
});

test("retries provider pressure while failing closed on semantic RPC errors", async () => {
  assert.equal(isRetryablePonsRpcError(new Error("http_429")), true);
  assert.equal(isRetryablePonsRpcError(new Error("http_503")), true);
  assert.equal(isRetryablePonsRpcError(new Error("rpc_-32005")), true);
  assert.equal(isRetryablePonsRpcError(new Error("timeout")), true);
  assert.equal(isRetryablePonsRpcError(new Error("pons_chain_mismatch")), false);

  assert.equal(ponsLogRangeLimit(new Error(
    "eth_getLogs block range too large: 1600 blocks requested, filtered queries on this chain are limited to 200 blocks."
  )), 200);

  assert.equal(ponsLogRangeLimit(new Error(
    "Under the Free tier plan, you can make eth_getLogs requests with up to a 10 block range."
  )), 10);

  assert.equal(ponsLogRangeLimit(new Error(
    "eth_getLogs is limited to a 5 range, upgrade from discover plan."
  )), 5);

  assert.equal(ponsLogRangeLimit(new Error("http_429")), null);

  const rpc = await readFile(new URL("../lib/ingestion/pons-rpc.ts", import.meta.url), "utf8");
  assert.match(await readFile(new URL("../lib/ingestion/rpc-transport.ts", import.meta.url), "utf8"), /retry-after/);
  assert.match(rpc, /providerHealth/);
  assert.match(rpc, /PROVIDER_OPERATION_BUDGET_MS/);
  assert.match(rpc, /getPonsLogsAdaptive/);
});

test("materializes one durable state artifact and exposes multi-horizon memory", async () => {
  const [ledger, historyLedger, indexer, model, interfaceSource, migration] = await Promise.all([
    readFile(new URL("../db/pons-ledger.ts", import.meta.url), "utf8"),
    readFile(new URL("../db/pons-history-ledger.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/ingestion/pons-live.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/pons/model.ts", import.meta.url), "utf8"),
    readFile(new URL("../components/pons-observatory.tsx", import.meta.url), "utf8"),
    readFile(new URL("../drizzle/0008_natural_blazing_skull.sql", import.meta.url), "utf8"),
  ]);
  assert.match(ledger, /const MEMORY_HORIZONS/);
  for (const horizon of ["8m", "1h", "6h", "24h", "7d"]) assert.match(ledger, new RegExp(`id: "${horizon}"`));
  assert.match(ledger, /cachePonsState/);
  assert.match(ledger, /loadCachedPonsState/);
  assert.match(indexer, /recordPonsActivitySnapshot\(state.index.latestSeenBlock, state\)/);
  assert.match(indexer, /cachePonsState\(state\)/);
  assert.match(indexer, /acquireAuxJob\("materialize"/);
  assert.match(indexer, /progress.latest_safe_block !== state.index.latestIndexedBlock/);
  assert.match(ledger, /WITH trade_metrics AS MATERIALIZED/);
  assert.match(historyLedger, /WITH recent_launches AS MATERIALIZED/);
  assert.ok(indexer.indexOf("completeCollectionRun(run.id") < indexer.indexOf("export async function materializePonsState"));
  assert.doesNotMatch(indexer, /await pendingPonsMetadata|await readPonsTokenMetadata/);
  assert.match(model, /PonsMemoryHorizon/);
  assert.match(interfaceSource, /State Memory/);
  assert.match(interfaceSource, /market merely loud/);
  assert.match(migration, /CREATE TABLE `pons_state_cache`/);
});

test("keeps PONS generations explicit and excludes shallow coverage from rankings", async () => {
  const [constants, ledger, historyLedger, historyIndexer, model, interfaceSource, coverageSource] = await Promise.all([
    readFile(new URL("../lib/pons/constants.ts", import.meta.url), "utf8"),
    readFile(new URL("../db/pons-ledger.ts", import.meta.url), "utf8"),
    readFile(new URL("../db/pons-history-ledger.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/ingestion/pons-history.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/pons/model.ts", import.meta.url), "utf8"),
    readFile(new URL("../components/pons-observatory.tsx", import.meta.url), "utf8"),
    readFile(new URL("../components/protocol-coverage.tsx", import.meta.url), "utf8"),
  ]);
  assert.match(constants, /PONS_V1_CURRENT_FACTORY/);
  assert.match(constants, /PONS_V1_LEGACY_FACTORY/);
  assert.match(constants, /v1Launch/);
  assert.match(constants, /v3Swap/);
  assert.match(model, /PonsProtocolGeneration/);
  assert.match(model, /PonsProtocolHistory/);
  assert.match(ledger, /PONS V2 ranks · V1 history reconstructed independently/);
  assert.match(ledger, /rankingEligible: false/);
  assert.match(historyLedger, /pons_generation_index_state/);
  assert.match(historyIndexer, /LAUNCH_DISCOVERY_BLOCKS = 20_000/);
  assert.match(historyIndexer, /SWAP_RECONSTRUCTION_BLOCKS = 4_000/);
  assert.match(coverageSource, /Protocol coverage/);
  assert.match(interfaceSource, /TabsContent value="history"/);
  assert.match(coverageSource, /Outside rankings/);
});

test("classifies short-horizon PONS activity without inventing growth from a zero baseline", () => {
  assert.equal(ponsMomentumPercent(8, 4), 100);
  assert.equal(ponsMomentumPercent(3, 0), null);
  assert.equal(classifyPonsSignal({ recent: 3, previous: 0, recentActors: 2 }), "forming");
  assert.equal(classifyPonsSignal({ recent: 12, previous: 4, recentActors: 7 }), "surging");
  assert.equal(classifyPonsSignal({ recent: 2, previous: 8, recentActors: 2 }), "cooling");
  assert.equal(ponsSignalConfidence(14, 8), "high");
  assert.equal(normalizePonsWindowBlocks(25_000), 25_000);
  assert.equal(normalizePonsWindowBlocks(12_345), 100_000);
});

test("accepts two-provider Robinhood evidence while reserving healthy status for the target quorum", () => {
  assert.deepEqual(assessRobinhoodRpcQuorum({ agreedProviders: 1 }), {
    accepted: false, degraded: true, multiplierMismatch: false,
  });
  assert.deepEqual(assessRobinhoodRpcQuorum({ agreedProviders: 2 }), {
    accepted: true, degraded: true, multiplierMismatch: false,
  });
  assert.deepEqual(assessRobinhoodRpcQuorum({ agreedProviders: 3 }), {
    accepted: true, degraded: false, multiplierMismatch: false,
  });
  assert.deepEqual(assessRobinhoodRpcQuorum({ agreedProviders: 3, multiplierVerified: 1, multiplierTotal: 2 }), {
    accepted: true, degraded: true, multiplierMismatch: true,
  });
});


test("scheduled PONS commits refresh the durable state inside the freshness window", async () => {
  const [cycle, research] = await Promise.all([
    readFile(new URL("../lib/ingestion/collector-cycle.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/pons/research.ts", import.meta.url), "utf8"),
  ]);
  assert.match(cycle, /materializePonsState/);
  assert.match(cycle, /pons-materialize/);
  assert.match(research, /age\(state\.generatedAt/);
});


test("scheduled holder research follows live attention instead of scanning launches blindly", async () => {
  const [researchDb, cycle] = await Promise.all([
    readFile(new URL("../db/pons-research.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/ingestion/collector-cycle.ts", import.meta.url), "utf8"),
  ]);

  assert.match(researchDb, /recent_trades/);
  assert.match(researchDb, /recent_actors/);
  assert.match(researchDb, /previous_trades/);
  assert.match(researchDb, /graduation/);
  assert.match(researchDb, /sweep/);
  assert.match(cycle, /withScheduledResearch/);
  assert.match(cycle, /pons-research/);
  assert.match(cycle, /runTokenResearch/);
});


test("holder research follows the live edge and deepens samples through bounded RPC chunks", async () => {
  const [researchDb, researchIngestion, rpc] = await Promise.all([
    readFile(new URL("../db/pons-research.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/ingestion/pons-research.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/ingestion/pons-rpc.ts", import.meta.url), "utf8"),
  ]);

  assert.match(researchDb, /GROUP BY t\.actor_address/);
  assert.match(researchDb, /LIMIT 48/);
  assert.match(
    researchDb,
    /ORDER BY\s+COALESCE\(a\.recent_trades, 0\) DESC,\s+COALESCE\(a\.recent_actors, 0\) DESC,\s+COALESCE\(r\.checked_at, 0\) ASC,\s+l\.block_number DESC/
  );
  assert.match(researchIngestion, /HOLDER_RPC_CHUNK_REQUESTS = 24/);
  assert.match(researchIngestion, /holderDeadline/);
  assert.match(researchIngestion, /holder_sample_budget_exhausted/);
  assert.match(rpc, /readPonsContracts\(requests: RpcRequest\[\], deadline = Infinity\)/);
});


test("small holder samples remain unverified without claiming holder depletion", () => {
  const reading = assessLaunch({
    ...viable,
    currentEvidence: {
      ...viable.currentEvidence,
      holderSampleSize: 6,
      meaningfulHolders: 4,
      largestWalletSharePercent: 2,
    },
  }, true, now);

  assert.equal(reading.eligible, false);
  assert.equal(reading.signal, "unverified");
  assert.equal(reading.label, "Holder sample incomplete");
  assert.match(reading.reasons.join(" "), /6 readable non-contract wallets/);
});


test("holder research samples signal windows and schedules two sequential refreshes", async () => {
  const [researchDb, researchIngestion, cycle] = await Promise.all([
    readFile(new URL("../db/pons-research.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/ingestion/pons-research.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/ingestion/collector-cycle.ts", import.meta.url), "utf8"),
  ]);

  assert.match(researchDb, /PONS_SIGNAL_WINDOW_BLOCKS \* 2/);
  assert.match(researchDb, /GROUP BY t\.actor_address/);
  assert.match(researchDb, /LIMIT 48/);
  assert.doesNotMatch(researchDb, /ORDER BY block_number DESC LIMIT 300/);

  assert.match(researchIngestion, /options: \{ intervalMs\?: number \}/);
  assert.match(researchIngestion, /options\.intervalMs \?\? 5_000/);

  assert.match(cycle, /slot < 2/);
  assert.match(cycle, /intervalMs: 0/);
  assert.match(cycle, /pons-research-\$\{slot \+ 1\}/);
});


test("holder research prioritizes candidates that can still clear the participation policy", async () => {
  const researchDb = await readFile(
    new URL("../db/pons-research.ts", import.meta.url),
    "utf8"
  );

  assert.match(researchDb, /previous_actors/);
  assert.match(researchDb, /COALESCE\(a\.previous_actors, 0\) >= 3/);
  assert.match(
    researchDb,
    /COALESCE\(a\.recent_trades, 0\) \* 2 >= COALESCE\(a\.previous_trades, 0\)/
  );
});


test("holder evidence refresh cadence uses the freshness window efficiently", async () => {
  const researchDb = await readFile(
    new URL("../db/pons-research.ts", import.meta.url),
    "utf8"
  );

  assert.match(researchDb, /PONS_HOLDER_REFRESH_MS = 8 \* 60_000/);
  assert.match(researchDb, /PONS_HOLDER_RETRY_MS = 3 \* 60_000/);
  assert.match(
    researchDb,
    /evidence\.observedAt \? PONS_HOLDER_REFRESH_MS : PONS_HOLDER_RETRY_MS/
  );
});


test("automatic holder research excludes tokens that cannot currently qualify", async () => {
  const researchDb = await readFile(
    new URL("../db/pons-research.ts", import.meta.url),
    "utf8"
  );

  assert.match(researchDb, /\? IS NOT NULL\s+OR \(/);
  assert.match(researchDb, /COALESCE\(a\.recent_trades, 0\) >= 12/);
  assert.match(researchDb, /COALESCE\(a\.recent_actors, 0\) >= 5/);
  assert.match(researchDb, /COALESCE\(a\.previous_trades, 0\) >= 6/);
  assert.match(researchDb, /COALESCE\(a\.previous_actors, 0\) >= 3/);
  assert.match(
    researchDb,
    /COALESCE\(a\.recent_trades, 0\) \* 2 >= COALESCE\(a\.previous_trades, 0\)/
  );
});


test("automatic holder research stays inside the surfaced live cohort", async () => {
  const researchDb = await readFile(
    new URL("../db/pons-research.ts", import.meta.url),
    "utf8"
  );

  assert.match(researchDb, /surfaced AS MATERIALIZED/);
  assert.match(researchDb, /LIMIT 120/);
  assert.match(
    researchDb,
    /l\.token_address IN \(SELECT token_address FROM surfaced\)/
  );
  assert.match(
    researchDb,
    /COALESCE\(a\.recent_trades, 0\) DESC/
  );
  assert.match(
    researchDb,
    /COALESCE\(a\.window_trades, 0\) DESC/
  );
});


test("canonical PONS materialization persists sparse per-token state memory", async () => {
  const [schema, researchDb, live] = await Promise.all([
    readFile(new URL("../db/schema.ts", import.meta.url), "utf8"),
    readFile(new URL("../db/pons-research.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/ingestion/pons-live.ts", import.meta.url), "utf8"),
  ]);

  assert.match(schema, /pons_token_state_history/);
  assert.match(schema, /pons_token_state_history_token_time_idx/);

  assert.match(
    researchDb,
    /PONS_TOKEN_STATE_HEARTBEAT_MS = 60 \* 60_000/
  );
  assert.match(
    researchDb,
    /state\.mode !== "live" \|\| state\.pulse\.status !== "verified"/
  );
  assert.match(researchDb, /changes\.push\("signal"\)/);
  assert.match(researchDb, /changes\.push\("eligibility"\)/);
  assert.match(researchDb, /changes\.push\("lifecycle"\)/);
  assert.match(researchDb, /changes\.push\("evidence"\)/);
  assert.match(researchDb, /changes\.push\("holder-breadth"\)/);
  assert.match(researchDb, /changes\.push\("heartbeat"\)/);

  assert.match(live, /decorateResearch\(state\)/);
  assert.match(live, /recordPonsTokenStateHistory\(decorated\)/);
});


test("token state memory exposes deterministic transition explanations", async () => {
  const [model, researchDb] = await Promise.all([
    readFile(new URL("../lib/pons/model.ts", import.meta.url), "utf8"),
    readFile(new URL("../db/pons-research.ts", import.meta.url), "utf8"),
  ]);

  assert.match(model, /PonsTokenStateTransition/);
  assert.match(model, /stateTransition\?: PonsTokenStateTransition \| null/);

  assert.match(researchDb, /loadPonsTokenTransitions/);
  assert.match(researchDb, /ROW_NUMBER\(\) OVER/);
  assert.match(researchDb, /WHERE state_rank <= 2/);

  assert.match(researchDb, /return "recovered"/);
  assert.match(researchDb, /return "verification-lost"/);
  assert.match(researchDb, /return "stress-cleared"/);
  assert.match(
    researchDb,
    /Sampled holder breadth crossed the verification requirement/
  );
  assert.match(
    researchDb,
    /Current eligibility requirements are now satisfied/
  );
  assert.match(
    researchDb,
    /stateTransition: transitions\.get\(launch\.tokenAddress\) \?\? null/
  );
});


test("transition explanations distinguish inactivity and surface stress reasons", async () => {
  const [model, researchDb] = await Promise.all([
    readFile(new URL("../lib/pons/model.ts", import.meta.url), "utf8"),
    readFile(new URL("../db/pons-research.ts", import.meta.url), "utf8"),
  ]);

  assert.match(model, /\| "inactive"/);
  assert.match(
    researchDb,
    /current\.signal === "inactive" && previous\.signal !== "inactive"/
  );
  assert.match(
    researchDb,
    /case "inactive": return "Participation became inactive"/
  );
  assert.match(researchDb, /payloadStrings\(after, "researchReasons"\)/);
});
