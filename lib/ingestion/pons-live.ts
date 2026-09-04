import {
  acquirePonsIndexLease,
  cachePonsState,
  clearPonsStagedRange,
  getPonsState,
  initializePonsIndex,
  loadCachedPonsState,
  loadPonsIndexState,
  markPonsIndexFailure,
  markPonsIndexSuccess,
  pendingPonsMetadata,
  persistPonsLogs,
  prunePonsObservations,
  recordPonsActivitySnapshot,
  rewindPonsIndex,
  updatePonsMetadata,
} from "@/db/pons-ledger";
import {
  completeCollectionRun,
  failCollectionRun,
  recordEngineAlert,
  recordSourceObservation,
  resolveEngineAlert,
  startCollectionRun,
  updateRunPhase,
  type CollectionTrigger,
} from "@/db/engine-ledger";
import { PONS_FINALITY_BLOCKS, PONS_V2_DEPLOYMENT_FLOOR } from "@/lib/pons/constants";
import { getPonsBlock, getPonsHead, getPonsLogs, readPonsTokenMetadata } from "@/lib/ingestion/pons-rpc";
import { ponsCollectionBudget } from "@/lib/pons/budget";

const LOG_CHUNK_BLOCKS = 2_000;
const REORG_REWIND_BLOCKS = 256;
const LIVE_RPC_CONCURRENCY = 2;
const METADATA_BUDGET_MS = 1_500;
const MATERIALIZATION_START_DEADLINE_MS = 21_000;
const MAINTENANCE_START_DEADLINE_MS = 27_000;

function ranges(fromBlock: number, toBlock: number, size = LOG_CHUNK_BLOCKS) {
  const result: Array<{ fromBlock: number; toBlock: number }> = [];
  for (let start = fromBlock; start <= toBlock; start += size) {
    result.push({ fromBlock: start, toBlock: Math.min(toBlock, start + size - 1) });
  }
  return result;
}

async function mapWithConcurrency<T, R>(items: T[], limit: number, mapper: (item: T) => Promise<R>) {
  const result = new Array<R>(items.length);
  let cursor = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      result[index] = await mapper(items[index]);
    }
  }));
  return result;
}

function collectionErrorCode(error: unknown) {
  return (error instanceof Error ? error.message : "metadata unavailable")
    .toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 96) || "unknown";
}

async function withinMilliseconds<T>(promise: Promise<T>, milliseconds: number) {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_resolve, reject) => {
        timeout = setTimeout(() => reject(new Error("metadata_budget_exhausted")), milliseconds);
      }),
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

export async function runPonsCollection(trigger: CollectionTrigger, options: { force?: boolean } = {}) {
  const acquired = await acquirePonsIndexLease({ force: options.force });
  if (!acquired) return { status: "skipped" as const, reason: "fresh PONS index or active lease" };

  let run: Awaited<ReturnType<typeof startCollectionRun>> | null = null;
  let phase = "head";
  try {
    run = await startCollectionRun(trigger, "pons-index");
    const startedAt = Date.now();
    await updateRunPhase(run.id, phase);
    const head = await getPonsHead();
    const safeHead = Math.max(PONS_V2_DEPLOYMENT_FLOOR, head.number - PONS_FINALITY_BLOCKS);
    let state = await initializePonsIndex(head.number);
    if (!state) throw new Error("pons_index_state_missing");

    if (state.latest_safe_block > 0 && state.latest_safe_hash) {
      phase = "reorg-check";
      await updateRunPhase(run.id, phase, { latestSafeBlock: state.latest_safe_block });
      const canonical = await getPonsBlock(state.latest_safe_block);
      if (canonical.hash !== state.latest_safe_hash.toLowerCase()) {
        const rewindBlock = Math.max(PONS_V2_DEPLOYMENT_FLOOR, state.latest_safe_block - REORG_REWIND_BLOCKS);
        await rewindPonsIndex(rewindBlock);
        state = await loadPonsIndexState();
        if (!state) throw new Error("pons_index_state_missing_after_rewind");
      }
    }

    phase = "live-index";
    const liveFrom = Math.max(PONS_V2_DEPLOYMENT_FLOOR, state.live_next_block);
    const lagBefore = Math.max(0, safeHead - liveFrom + 1);
    const budget = ponsCollectionBudget(lagBefore);
    const liveTo = Math.min(safeHead, liveFrom + budget.liveBlocks - 1);
    const liveRanges = liveTo >= liveFrom ? ranges(liveFrom, liveTo) : [];
    await updateRunPhase(run.id, phase, {
      strategy: budget.strategy, lagBefore, liveFrom, liveTo, chunks: liveRanges.length,
    });
    if (liveRanges.length) await clearPonsStagedRange(liveFrom);
    const liveBatches = await mapWithConcurrency(
      liveRanges,
      LIVE_RPC_CONCURRENCY,
      (range) => getPonsLogs(range.fromBlock, range.toBlock),
    );
    let launchCount = 0;
    let lifecycleCount = 0;
    let tradeCount = 0;
    for (const batch of liveBatches.sort((left, right) => left.fromBlock - right.fromBlock)) {
      const persisted = await persistPonsLogs({
        factoryLogs: batch.factoryLogs,
        curveLogs: batch.curveLogs,
        fallbackTimestamp: head.timestamp,
      });
      launchCount += persisted.launches;
      lifecycleCount += persisted.lifecycleEvents;
      tradeCount += persisted.trades;
    }

    phase = "historical-backfill";
    let backfillNext = Math.max(PONS_V2_DEPLOYMENT_FLOOR, state.backfill_next_block);
    const historicalFrom = backfillNext;
    let historicalTo: number | null = null;
    const historyCeiling = Math.max(PONS_V2_DEPLOYMENT_FLOOR - 1, liveFrom - 1);
    if (budget.backfillBlocks > 0 && backfillNext <= historyCeiling) {
      const historyTo = Math.min(historyCeiling, backfillNext + budget.backfillBlocks - 1);
      historicalTo = historyTo;
      const historyRanges = ranges(backfillNext, historyTo, 10_000);
      await updateRunPhase(run.id, phase, {
        strategy: budget.strategy, fromBlock: backfillNext, toBlock: historyTo, chunks: historyRanges.length,
      });
      const historicalBatches = await Promise.all(historyRanges.map((range) => getPonsLogs(range.fromBlock, range.toBlock, true)));
      for (const historical of historicalBatches.sort((left, right) => left.fromBlock - right.fromBlock)) {
        const persisted = await persistPonsLogs({
          factoryLogs: historical.factoryLogs,
          curveLogs: historical.curveLogs,
          fallbackTimestamp: head.timestamp,
        });
        launchCount += persisted.launches;
        lifecycleCount += persisted.lifecycleEvents;
        tradeCount += persisted.trades;
      }
      backfillNext = historyTo + 1;
    }

    phase = "commit";
    const latestProcessed = liveRanges.length ? liveTo : state.latest_safe_block;
    const latestBlock = latestProcessed > 0 ? await getPonsBlock(latestProcessed) : { hash: head.hash };
    const recordCount = launchCount + lifecycleCount + tradeCount;
    const liveBlocksProcessed = liveRanges.length ? liveTo - liveFrom + 1 : 0;
    const historicalBlocksProcessed = historicalTo === null ? 0 : historicalTo - historicalFrom + 1;
    await markPonsIndexSuccess({
      liveNextBlock: liveRanges.length ? liveTo + 1 : state.live_next_block,
      backfillNextBlock: backfillNext,
      latestSafeBlock: latestProcessed,
      latestSafeHash: latestBlock.hash,
      latestSeenBlock: head.number,
      recordCount,
    });

    phase = "metadata";
    let pending: Array<{ tokenAddress: string }> = [];
    let metadata: Awaited<ReturnType<typeof readPonsTokenMetadata>> = {
      records: [], provider: "unavailable", latencyMs: 0,
    };
    let metadataErrorCode: string | null = null;
    try {
      await updateRunPhase(run.id, phase, {
        pendingLimit: budget.metadataLimit, priority: "observed-trades", budgetMs: METADATA_BUDGET_MS,
      });
      if (budget.metadataLimit > 0) {
        pending = await pendingPonsMetadata(budget.metadataLimit);
        metadata = await withinMilliseconds(readPonsTokenMetadata(pending), METADATA_BUDGET_MS);
        await updatePonsMetadata(metadata.records);
      }
    } catch (error) {
      metadataErrorCode = collectionErrorCode(error);
    }

    const metadataResolved = metadata.records.filter((record) => record.ok).length;
    const runMetadata = {
      source: "pons-v2",
      strategy: budget.strategy,
      provider: head.provider,
      headBlock: head.number,
      safeHead,
      latestProcessed,
      liveFrom,
      liveTo: liveRanges.length ? liveTo : null,
      liveBlocksProcessed,
      historicalFrom: historicalTo === null ? null : historicalFrom,
      historicalTo,
      historicalBlocksProcessed,
      recordCount,
      metadataRequested: pending.length,
      metadataResolved,
      metadataProvider: metadata.provider,
      metadataErrorCode,
      metadataBudgetMs: METADATA_BUDGET_MS,
    };
    await recordSourceObservation(run.id, {
      source: "pons-v2-rpc",
      status: safeHead - latestProcessed > LOG_CHUNK_BLOCKS ? "stale" : "ok",
      startedAt,
      completedAt: Date.now(),
      freshnessMs: Math.max(0, Date.now() - head.timestamp * 1000),
      recordCount,
      metadata: {
        provider: head.provider,
        headBlock: head.number,
        safeHead,
        latestProcessed,
        launches: launchCount,
        lifecycleEvents: lifecycleCount,
        trades: tradeCount,
        metadataRecords: metadataResolved,
        strategy: budget.strategy,
        liveBlocksProcessed,
        historicalBlocksProcessed,
        metadataErrorCode,
      },
    });
    await completeCollectionRun(run.id, run.startedAt, {
      snapshotId: null,
      discoveredSpecies: launchCount,
      observedSpecies: launchCount,
      verifiedSpecies: lifecycleCount,
      warningCount: (safeHead - latestProcessed > LOG_CHUNK_BLOCKS ? 1 : 0) + (metadataErrorCode ? 1 : 0),
      metadata: runMetadata,
    });
    await resolveEngineAlert("pons_collection_failed", "collector", "pons-v2").catch(() => undefined);
    const elapsedBeforeMaterialization = Date.now() - startedAt;
    if (elapsedBeforeMaterialization <= MATERIALIZATION_START_DEADLINE_MS) {
      const materializationStartedAt = Date.now();
      try {
        const materializedState = await getPonsState();
        await Promise.all([
          recordPonsActivitySnapshot(head.number, materializedState),
          cachePonsState(materializedState),
        ]);
        console.info("PONS state materialized", {
          indexedBlock: materializedState.index.latestIndexedBlock,
          durationMs: Date.now() - materializationStartedAt,
        });
      } catch (error) {
        console.error("PONS state materialization failed", {
          message: error instanceof Error ? error.message : String(error),
        });
      }
    } else {
      console.info("PONS state materialization deferred", {
        latestProcessed,
        elapsedMs: elapsedBeforeMaterialization,
      });
    }
    if (Date.now() - startedAt <= MAINTENANCE_START_DEADLINE_MS) {
      await prunePonsObservations().catch(() => undefined);
    }
    return {
      status: "recorded" as const,
      headBlock: head.number,
      latestProcessed,
      launches: launchCount,
      lifecycleEvents: lifecycleCount,
      trades: tradeCount,
      metadata: metadata.records.length,
      metadataErrorCode,
      strategy: budget.strategy,
      liveBlocksProcessed,
      historicalBlocksProcessed,
    };
  } catch (error) {
    await markPonsIndexFailure(error).catch(() => undefined);
    if (run) await failCollectionRun(run.id, run.startedAt, phase, error).catch(() => undefined);
    await recordEngineAlert({
      severity: "critical",
      code: "pons_collection_failed",
      entityType: "collector",
      entityId: "pons-v2",
      message: `PONS indexing failed during ${phase}: ${error instanceof Error ? error.message.slice(0, 160) : "unknown"}`,
      evidence: { phase, trigger, runId: run?.id },
    }).catch(() => undefined);
    throw error;
  }
}

export async function runScheduledPonsCollection() {
  return runPonsCollection("scheduled");
}

export async function runRequestPonsCollection(force = false) {
  return runPonsCollection(force ? "manual" : "request-watchdog", { force });
}

export async function servePonsState(windowBlocks?: number) {
  return await loadCachedPonsState(windowBlocks) ?? getPonsState(windowBlocks);
}
