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
  persistPonsLogs,
  recordPonsActivitySnapshot,
  rewindPonsIndex,
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
import { getPonsBlock, getPonsHead, getPonsLogs } from "@/lib/ingestion/pons-rpc";
import { ponsCollectionBudget } from "@/lib/pons/budget";

const LOG_CHUNK_BLOCKS = 2_000;
const REORG_REWIND_BLOCKS = 256;
const LIVE_RPC_CONCURRENCY = 2;


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

export async function runPonsCollection(trigger: CollectionTrigger, options: { force?: boolean } = {}) {
  const acquired = await acquirePonsIndexLease({ force: options.force });
  if (!acquired) return { status: "skipped" as const, reason: "fresh PONS index or active lease" };

  let run: Awaited<ReturnType<typeof startCollectionRun>> | null = null;
  let phase = "head";
  try {
    run = await startCollectionRun(trigger, "pons-index");
    const startedAt = Date.now();
    const rpcDeadline = startedAt + 20_000;
    await updateRunPhase(run.id, phase);
    const head = await getPonsHead(rpcDeadline);
    const safeHead = Math.max(PONS_V2_DEPLOYMENT_FLOOR, head.number - PONS_FINALITY_BLOCKS);
    let state = await initializePonsIndex(head.number);
    if (!state) throw new Error("pons_index_state_missing");

    if (state.latest_safe_block > 0 && state.latest_safe_hash) {
      phase = "reorg-check";
      await updateRunPhase(run.id, phase, { latestSafeBlock: state.latest_safe_block });
      const canonical = await getPonsBlock(state.latest_safe_block, false, rpcDeadline);
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
    if (liveRanges.length) await clearPonsStagedRange(liveFrom, liveTo);
    const liveBatches = await mapWithConcurrency(
      liveRanges,
      LIVE_RPC_CONCURRENCY,
      (range) => getPonsLogs(range.fromBlock, range.toBlock, false, rpcDeadline),
    );
    // Resolve the commit hash before database writes. A busy database must not
    // consume the RPC budget and force an otherwise complete batch to retry.
    const latestProcessed = liveRanges.length ? liveTo : state.latest_safe_block;
    const latestBlock = latestProcessed > 0 ? await getPonsBlock(latestProcessed, false, rpcDeadline) : { hash: head.hash };
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
    let historicalErrorCode: string | null = null;
    const historyCeiling = Math.max(PONS_V2_DEPLOYMENT_FLOOR - 1, liveFrom - 1);

    // Historical memory is opportunistic. Never allow it to invalidate a
    // successfully fetched and persisted live edge. Reserve RPC time for the
    // canonical commit and leave the backfill cursor unchanged on failure.
    const historyDeadline = rpcDeadline - 2_000;
    if (budget.backfillBlocks > 0 && backfillNext <= historyCeiling) {
      const historyTo = Math.min(historyCeiling, backfillNext + budget.backfillBlocks - 1);
      const historyRanges = ranges(backfillNext, historyTo, 10_000);
      await updateRunPhase(run.id, phase, {
        strategy: budget.strategy, fromBlock: backfillNext, toBlock: historyTo, chunks: historyRanges.length,
      });

      if (Date.now() >= historyDeadline) {
        historicalErrorCode = "history_budget_exhausted";
      } else {
        try {
          const historicalBatches = await Promise.all(
            historyRanges.map((range) => getPonsLogs(range.fromBlock, range.toBlock, true, historyDeadline)),
          );
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
          historicalTo = historyTo;
          backfillNext = historyTo + 1;
        } catch (error) {
          const message = error instanceof Error ? error.message : "history_backfill_unavailable";
          historicalErrorCode = /^[a-zA-Z0-9_:-]{1,80}$/.test(message)
            ? message
            : "history_backfill_unavailable";
        }
      }
    }

    phase = "commit";
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

    const metadataResolved = 0;
    const metadataErrorCode: string | null = null;
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
      historicalErrorCode,
      recordCount,
      metadataRequested: 0,
      metadataResolved,
      metadataProvider: "separate-lane",
      metadataErrorCode,
      metadataBudgetMs: 0,
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
        historicalErrorCode,
        metadataErrorCode,
      },
    });
    await completeCollectionRun(run.id, run.startedAt, {
      snapshotId: null,
      discoveredSpecies: launchCount,
      observedSpecies: launchCount,
      verifiedSpecies: lifecycleCount,
      warningCount: (safeHead - latestProcessed > LOG_CHUNK_BLOCKS ? 1 : 0)
        + (metadataErrorCode ? 1 : 0)
        + (historicalErrorCode ? 1 : 0),
      metadata: runMetadata,
    });
    await resolveEngineAlert("pons_collection_failed", "collector", "pons-v2").catch(() => undefined);
    return {
      status: "recorded" as const,
      headBlock: head.number,
      latestProcessed,
      launches: launchCount,
      lifecycleEvents: lifecycleCount,
      trades: tradeCount,
      metadata: 0,
      metadataErrorCode,
      strategy: budget.strategy,
      liveBlocksProcessed,
      historicalBlocksProcessed,
      historicalErrorCode,
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

export async function materializePonsState(windowBlocks?: number) {
  const { acquireAuxJob, releaseAuxJob } = await import("@/db/pons-research");
  if (!await acquireAuxJob("materialize", 20_000)) return null;
  try {
    const state = await getPonsState(windowBlocks);
    await cachePonsState(state);
    await recordPonsActivitySnapshot(state.index.latestSeenBlock, state);
    return state;
  } finally { await releaseAuxJob("materialize"); }
}

export async function servePonsState(windowBlocks?: number, token?: string, browse?: { pair?: string; phase?: string }, background?: (task: Promise<unknown>) => void) {
  const { decorateResearch } = await import("@/db/pons-research");
  const [cached, progress] = await Promise.all([loadCachedPonsState(windowBlocks), loadPonsIndexState()]);
  let state = cached;
  // Rebuilding large historical aggregates after every small archive commit
  // blocks the same D1 database needed by the recent-event feed. Keep the dated
  // artifact for five minutes during deep recovery; progress still updates now.
  const refreshAfter = progress && progress.latest_seen_block - progress.latest_safe_block > 40_000 ? 300_000 : 30_000;
  // Rebuild in its own request lifetime when the artifact falls behind a commit.
  // Never relabel a cached artifact with a newer block than its actual evidence.
  if (!state || progress && progress.latest_safe_block !== state.index.latestIndexedBlock && Date.now() - Date.parse(state.generatedAt) > refreshAfter) {
    const rebuild = materializePonsState(windowBlocks);
    if (state && background) background(rebuild.catch(() => console.error("PONS snapshot refresh unavailable")));
    else state = await rebuild ?? state;
  }
  if (!state) state = await getPonsState(windowBlocks);
  if (progress) {
    state.collectionProgress = { indexedBlock: progress.latest_safe_block, headBlock: progress.latest_seen_block,
      lagBlocks: Math.max(0, progress.latest_seen_block - progress.latest_safe_block),
      lastSuccessAt: progress.last_success_at ? new Date(progress.last_success_at).toISOString() : null };
    state.index.consecutiveFailures = progress.consecutive_failures;
    state.index.latestSeenBlock = Math.max(state.index.latestSeenBlock, progress.latest_seen_block);
    state.index.liveLagBlocks = Math.max(0, state.index.latestSeenBlock - state.index.latestIndexedBlock);
  }
  const { loadFactoryFeed } = await import("@/db/pons-factory");
  return decorateResearch({ ...state, factoryLive: await loadFactoryFeed() }, token, browse);
}
