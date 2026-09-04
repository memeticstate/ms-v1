import {
  acquirePonsGenerationLease,
  getPonsV1PoolAddresses,
  loadPonsGenerationState,
  markPonsGenerationFailure,
  markPonsGenerationSuccess,
  pendingPonsV1Metadata,
  persistPonsV1LaunchLogs,
  persistPonsV1SwapLogs,
  updatePonsV1Metadata,
} from "@/db/pons-history-ledger";
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
import {
  getPonsHead,
  getPonsV1LaunchLogs,
  getPonsV1SwapLogs,
  readPonsTokenMetadata,
} from "@/lib/ingestion/pons-rpc";
import {
  PONS_FINALITY_BLOCKS,
  PONS_V1_GENERATIONS,
  type PonsV1GenerationId,
} from "@/lib/pons/constants";

const LAUNCH_DISCOVERY_BLOCKS = 20_000;
const LAUNCH_CHUNK_BLOCKS = 5_000;
const SWAP_RECONSTRUCTION_BLOCKS = 4_000;
const SWAP_CHUNK_BLOCKS = 2_000;
const METADATA_BUDGET_MS = 3_000;

function ranges(fromBlock: number, toBlock: number, size: number) {
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

export async function runPonsHistoryCollection(
  trigger: CollectionTrigger,
  generationId: PonsV1GenerationId,
  options: { force?: boolean } = {},
) {
  const acquired = await acquirePonsGenerationLease(generationId, options.force ?? false);
  if (!acquired) return { status: "skipped" as const, reason: "fresh PONS history lane or active lease" };

  const generation = PONS_V1_GENERATIONS[generationId];
  let run: Awaited<ReturnType<typeof startCollectionRun>> | null = null;
  let phase = "history-head";
  try {
    run = await startCollectionRun(trigger, `pons-history:${generationId}`);
    const startedAt = Date.now();
    await updateRunPhase(run.id, phase, { generationId, factory: generation.factory });
    const head = await getPonsHead();
    const safeHead = Math.max(generation.startBlock, head.number - PONS_FINALITY_BLOCKS);
    const state = await loadPonsGenerationState(generationId);
    if (!state) throw new Error("pons_generation_state_missing");

    let launchNextBlock = state.launch_next_block;
    let swapNextBlock = state.swap_next_block;
    let launchCount = 0;
    let swapCount = 0;
    let blocksProcessed = 0;
    let lane: "launch-discovery" | "swap-reconstruction" | "live-maintenance";

    if (launchNextBlock <= safeHead) {
      lane = "launch-discovery";
      phase = lane;
      const toBlock = Math.min(safeHead, launchNextBlock + LAUNCH_DISCOVERY_BLOCKS - 1);
      const chunks = ranges(launchNextBlock, toBlock, LAUNCH_CHUNK_BLOCKS);
      await updateRunPhase(run.id, phase, { generationId, fromBlock: launchNextBlock, toBlock, chunks: chunks.length });
      const batches = await mapWithConcurrency(chunks, 2, (range) =>
        getPonsV1LaunchLogs(generationId, range.fromBlock, range.toBlock));
      for (const batch of batches.sort((left, right) => left.fromBlock - right.fromBlock)) {
        launchCount += await persistPonsV1LaunchLogs(generationId, batch.logs, head.timestamp);
      }
      blocksProcessed = toBlock - launchNextBlock + 1;
      launchNextBlock = toBlock + 1;
    } else if (swapNextBlock <= safeHead) {
      lane = "swap-reconstruction";
      phase = lane;
      const toBlock = Math.min(safeHead, swapNextBlock + SWAP_RECONSTRUCTION_BLOCKS - 1);
      const chunks = ranges(swapNextBlock, toBlock, SWAP_CHUNK_BLOCKS);
      const poolAddresses = await getPonsV1PoolAddresses(generationId);
      await updateRunPhase(run.id, phase, { generationId, fromBlock: swapNextBlock, toBlock, chunks: chunks.length });
      const batches = await mapWithConcurrency(chunks, 1, (range) =>
        getPonsV1SwapLogs(range.fromBlock, range.toBlock, poolAddresses));
      for (const batch of batches.sort((left, right) => left.fromBlock - right.fromBlock)) {
        swapCount += await persistPonsV1SwapLogs(generationId, batch.logs, head.timestamp);
      }
      blocksProcessed = toBlock - swapNextBlock + 1;
      swapNextBlock = toBlock + 1;
    } else {
      lane = "live-maintenance";
      phase = lane;
      await updateRunPhase(run.id, phase, { generationId, safeHead });
    }

    phase = "history-commit";
    await markPonsGenerationSuccess({
      generationId,
      latestSeenBlock: head.number,
      launchNextBlock,
      swapNextBlock,
      recordCount: launchCount + swapCount,
    });

    let metadataResolved = 0;
    try {
      const pending = await pendingPonsV1Metadata(generationId, 10);
      const metadata = await withinMilliseconds(readPonsTokenMetadata(pending), METADATA_BUDGET_MS);
      await updatePonsV1Metadata(metadata.records);
      metadataResolved = metadata.records.filter((record) => record.ok).length;
    } catch {
      // Metadata must never block a committed historical cursor.
    }

    const completedAt = Date.now();
    await recordSourceObservation(run.id, {
      source: `pons-${generationId}-rpc`,
      status: launchNextBlock > safeHead && swapNextBlock > safeHead ? "ok" : "stale",
      startedAt,
      completedAt,
      freshnessMs: Math.max(0, Date.now() - head.timestamp * 1000),
      recordCount: launchCount + swapCount,
      metadata: {
        generationId,
        lane,
        headBlock: head.number,
        safeHead,
        blocksProcessed,
        launchCount,
        swapCount,
        metadataResolved,
      },
    });
    await completeCollectionRun(run.id, run.startedAt, {
      snapshotId: null,
      discoveredSpecies: launchCount,
      observedSpecies: launchCount,
      verifiedSpecies: swapCount,
      warningCount: launchNextBlock > safeHead && swapNextBlock > safeHead ? 0 : 1,
      metadata: {
        generationId,
        lane,
        headBlock: head.number,
        safeHead,
        blocksProcessed,
        launchCount,
        swapCount,
        metadataResolved,
        launchNextBlock,
        swapNextBlock,
      },
    });
    await resolveEngineAlert("pons_history_failed", "collector", generationId).catch(() => undefined);
    return {
      status: "recorded" as const,
      generationId,
      lane,
      blocksProcessed,
      launchCount,
      swapCount,
      metadataResolved,
    };
  } catch (error) {
    await markPonsGenerationFailure(generationId, error).catch(() => undefined);
    if (run) await failCollectionRun(run.id, run.startedAt, phase, error).catch(() => undefined);
    await recordEngineAlert({
      severity: "warning",
      code: "pons_history_failed",
      entityType: "collector",
      entityId: generationId,
      message: `${generation.label} reconstruction failed during ${phase}: ${error instanceof Error ? error.message.slice(0, 160) : "unknown"}`,
      evidence: { phase, trigger, generationId, runId: run?.id },
    }).catch(() => undefined);
    throw error;
  }
}

export function runScheduledPonsHistoryCollection(generationId: PonsV1GenerationId) {
  return runPonsHistoryCollection("scheduled", generationId);
}

export function runRequestPonsHistoryCollection(generationId: PonsV1GenerationId, force = false) {
  return runPonsHistoryCollection(force ? "manual" : "request-watchdog", generationId, { force });
}
