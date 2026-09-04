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
const { isRetryablePonsRpcError } = await vite.ssrLoadModule("/lib/ingestion/pons-rpc.ts");

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
  assert.match(indexer, /metadataErrorCode/);
  assert.match(rpc, /eth_getLogs/);
  assert.match(rpc, /PONS_V2_FACTORY/);
  assert.match(ledger, /Launch velocity is separated from deployer breadth/);
  assert.match(ledger, /t\.block_number BETWEEN \? AND \?/);
  assert.match(ledger, /e\.block_number <= \?/);
  assert.doesNotMatch(`${indexer}\n${rpc}`, /api\.pons|ponsfamily\.com\/api/i);
});

test("keeps PONS collection inside the worker runtime while prioritizing the live edge", () => {
  const catchup = ponsCollectionBudget(150_000);
  const severeCatchup = ponsCollectionBudget(250_000);
  const balanced = ponsCollectionBudget(10_000);
  assert.deepEqual(catchup, { strategy: "live-catchup", liveBlocks: 2_500, backfillBlocks: 0, metadataLimit: 5 });
  assert.deepEqual(severeCatchup, { strategy: "live-catchup", liveBlocks: 3_000, backfillBlocks: 0, metadataLimit: 3 });
  assert.deepEqual(balanced, { strategy: "balanced", liveBlocks: 1_500, backfillBlocks: 1_500, metadataLimit: 8 });
  assert.ok(catchup.liveBlocks + catchup.backfillBlocks <= PONS_MAX_BLOCKS_PER_RUN);
  assert.ok(severeCatchup.liveBlocks + severeCatchup.backfillBlocks <= PONS_MAX_BLOCKS_PER_RUN);
  assert.equal(balanced.liveBlocks + balanced.backfillBlocks, PONS_MAX_BLOCKS_PER_RUN);
});

test("retries provider pressure while failing closed on semantic RPC errors", async () => {
  assert.equal(isRetryablePonsRpcError(new Error("http_429")), true);
  assert.equal(isRetryablePonsRpcError(new Error("http_503")), true);
  assert.equal(isRetryablePonsRpcError(new Error("rpc_-32005")), true);
  assert.equal(isRetryablePonsRpcError(new Error("timeout")), true);
  assert.equal(isRetryablePonsRpcError(new Error("pons_chain_mismatch")), false);

  const rpc = await readFile(new URL("../lib/ingestion/pons-rpc.ts", import.meta.url), "utf8");
  assert.match(rpc, /retry-after/);
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
  assert.match(indexer, /recordPonsActivitySnapshot\(head\.number, materializedState\)/);
  assert.match(indexer, /cachePonsState\(materializedState\)/);
  assert.match(ledger, /WITH trade_metrics AS MATERIALIZED/);
  assert.match(historyLedger, /WITH recent_launches AS MATERIALIZED/);
  assert.ok(indexer.indexOf("completeCollectionRun(run.id") < indexer.indexOf("const materializedState = await getPonsState()"));
  assert.match(model, /PonsMemoryHorizon/);
  assert.match(interfaceSource, /State Memory/);
  assert.match(interfaceSource, /market merely loud/);
  assert.match(migration, /CREATE TABLE `pons_state_cache`/);
});

test("keeps PONS generations explicit and excludes shallow coverage from rankings", async () => {
  const [constants, ledger, historyLedger, historyIndexer, model, interfaceSource] = await Promise.all([
    readFile(new URL("../lib/pons/constants.ts", import.meta.url), "utf8"),
    readFile(new URL("../db/pons-ledger.ts", import.meta.url), "utf8"),
    readFile(new URL("../db/pons-history-ledger.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/ingestion/pons-history.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/pons/model.ts", import.meta.url), "utf8"),
    readFile(new URL("../components/pons-observatory.tsx", import.meta.url), "utf8"),
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
  assert.match(interfaceSource, /Protocol coverage map/);
  assert.match(interfaceSource, /Complete PONS history/);
  assert.match(interfaceSource, /excluded from ranks/);
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
