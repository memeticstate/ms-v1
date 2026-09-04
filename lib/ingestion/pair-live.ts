import { affinitySnapshot } from "@/data/affinity-snapshot";
import {
  acquireCollectionLease,
  recordCollectionFailure,
  recordCollectionSuccess,
} from "@/db/collection-state";
import {
  completeCollectionRun,
  failCollectionRun,
  pruneEngineHistory,
  recordEngineAlert,
  recordSourceObservation,
  resolveEngineAlert,
  startCollectionRun,
  updateRunPhase,
  type CollectionTrigger,
} from "@/db/engine-ledger";
import { loadLatestChainBlock } from "@/db/chain-block-ledger";
import {
  loadLatestSnapshot,
  loadRecentVerifiedSnapshotRecords,
  pruneSnapshotHistory,
  recordSnapshot,
} from "@/db/snapshot-ledger";
import { normalizePairToken } from "@/lib/adapters/pair";
import type { AffinitySnapshot, SnapshotEnvelope, SnapshotSource, Species } from "@/lib/affinity-model";
import { collectPairCohort, pairSpeciesId, type ObservedPairToken } from "@/lib/ingestion/pair-cohort";
import {
  collectRobinhoodQuotes,
  habitatFromAsset,
  loadRobinhoodAssets,
  refreshRobinhoodRegistry,
  type RobinhoodAsset,
} from "@/lib/ingestion/robinhood-data";
import { reconcileRobinhoodChain } from "@/lib/ingestion/robinhood-reconcile";
import { deriveChainBlock } from "@/lib/interpretation/derive-chain-block";

const COHORT_COLORS = [
  "#82965d", "#9d7f48", "#b65c43", "#71858c", "#9c665b", "#bd7845",
  "#6f8867", "#909b94", "#a26f62", "#66807d", "#9a7f5a", "#787f67",
];

function source(
  id: SnapshotSource["id"],
  label: string,
  status: SnapshotSource["status"],
  observedAt?: string,
  details?: Pick<SnapshotSource, "latencyMs" | "recordCount">,
): SnapshotSource {
  return { id, label, status, ...(observedAt ? { observedAt } : {}), ...details };
}

function referenceEnvelope(now: string, warning: string): SnapshotEnvelope {
  return {
    snapshot: affinitySnapshot,
    meta: {
      mode: "reference",
      generatedAt: now,
      sourceObservedAt: affinitySnapshot.observedAt,
      sources: [
        source("pair", "PAIR discovery + metrics", "failed"),
        source("robinhood", "Robinhood asset registry", "failed"),
        source("robinhood-prices", "Robinhood underlying quotes", "failed"),
        source("robinhood-rpc", "Robinhood Chain RPC", "failed"),
      ],
      warnings: [warning],
      engineConfidence: 0,
    },
  };
}

function speciesPosition(index: number) {
  const columns = 3;
  const row = Math.floor(index / columns);
  const column = index % columns;
  const xOffsets = [350, 500, 650];
  const yOffsets = [205, 300, 395, 490];
  return { x: xOffsets[column], y: yOffsets[row] ?? 490 };
}

function buildSnapshot(
  tokens: ObservedPairToken[],
  assets: RobinhoodAsset[],
  quotes: Awaited<ReturnType<typeof collectRobinhoodQuotes>>["quotes"],
) {
  const species: Species[] = [];
  const edges: AffinitySnapshot["edges"] = [];
  const habitatWeight = new Map<string, number>();
  for (const token of tokens) {
    for (const pair of token.pairs) {
      habitatWeight.set(pair.quoteToken.symbol, (habitatWeight.get(pair.quoteToken.symbol) ?? 0) + pair.weightBps);
    }
  }
  const habitatSymbols = [...habitatWeight.keys()].sort((left, right) =>
    (habitatWeight.get(right) ?? 0) - (habitatWeight.get(left) ?? 0) || left.localeCompare(right));
  const assetBySymbol = new Map(assets.map((asset) => [asset.tokenSymbol, asset]));
  const habitats = habitatSymbols.flatMap((symbol, index) => {
    const asset = assetBySymbol.get(symbol);
    if (!asset) return [];
    return [{ ...habitatFromAsset(asset, index, habitatSymbols.length), quote: quotes.get(symbol) }];
  });

  tokens.forEach((token, index) => {
    const position = speciesPosition(index);
    const normalized = normalizePairToken({
      address: token.address,
      symbol: token.symbol,
      name: token.name,
      marketCapUsd: token.marketCapUsd,
      volumeUsd: token.volume24hUsd,
      liquidityUsd: token.liquidityUsd,
      totalDepthUsd: token.totalDepthUsd,
      activeVirtualSwapDepthUsd: token.activeVirtualSwapDepthUsd,
      priceUsd: token.priceUsd ?? undefined,
      trades24h: token.trades24h,
      priceChange24h: token.change24hPct,
      graduated: token.graduated,
      rank: token.rank,
      launchedAt: token.launchedAt ? new Date(token.launchedAt * 1000).toISOString() : undefined,
      creator: token.creator,
      launchTxHash: token.launchTxHash,
      marketDataSource: token.marketDataSource,
      marketDataUpdatedAt: token.marketDataUpdatedAt,
      markets: token.pairs.map((pair) => ({ symbol: pair.quoteToken.symbol, weightBps: pair.weightBps })),
    }, {
      id: pairSpeciesId(token),
      color: COHORT_COLORS[index % COHORT_COLORS.length],
      ...position,
    });
    species.push(normalized.species);
    edges.push(...normalized.edges);
  });

  return { habitats, species, edges };
}

async function registryWithFallback(runId: string) {
  try {
    return await refreshRobinhoodRegistry(runId);
  } catch (error) {
    const cached = await loadRobinhoodAssets().catch(() => []);
    await recordSourceObservation(runId, {
      source: "robinhood-registry",
      status: cached.length ? "stale" : "failed",
      startedAt: Date.now(),
      completedAt: Date.now(),
      recordCount: cached.length,
      errorCode: error instanceof Error ? error.message : "registry_failure",
      metadata: { fallback: cached.length ? "durable-registry" : "none" },
    }).catch(() => undefined);
    if (!cached.length) throw error;
    return { assets: cached, refreshed: false, stale: true, corporateActions: 0 };
  }
}

async function collectAffinitySnapshot(runId: string): Promise<SnapshotEnvelope> {
  const generatedAt = new Date().toISOString();
  await updateRunPhase(runId, "registry");
  const registry = await registryWithFallback(runId);

  await updateRunPhase(runId, "cohort-discovery", { registryAssets: registry.assets.length });
  const cohort = await collectPairCohort(runId, registry.assets);
  const habitatSymbols = [...new Set(cohort.tokens.flatMap((token) => token.pairs.map((pair) => pair.quoteToken.symbol)))];
  const sourceObservedAt = cohort.tokens.map((token) => token.marketDataUpdatedAt).sort().at(0) ?? generatedAt;

  await updateRunPhase(runId, "market-and-chain-evidence", {
    selectedSpecies: cohort.tokens.length,
    activeHabitats: habitatSymbols.length,
  });
  const assetBySymbol = new Map(registry.assets.map((asset) => [asset.tokenSymbol, asset]));
  const [quoteEvidence, history, latestBlock, chainEvidence] = await Promise.all([
    collectRobinhoodQuotes(runId, habitatSymbols, registry.assets),
    loadRecentVerifiedSnapshotRecords(13),
    loadLatestChainBlock(),
    reconcileRobinhoodChain(cohort.tokens.map((token) => ({
      speciesId: pairSpeciesId(token),
      contract: token.address.toLowerCase(),
      launchTxHash: token.launchTxHash,
    })), {
      runId,
      multiplierInputs: habitatSymbols.flatMap((symbol) => {
        const asset = assetBySymbol.get(symbol);
        return asset ? [{ symbol, contract: asset.contractAddress, expectedMultiplier: asset.currentMultiplier }] : [];
      }),
    }).catch(async (error) => {
      await recordSourceObservation(runId, {
        source: "robinhood-rpc",
        status: "failed",
        startedAt: Date.now(),
        completedAt: Date.now(),
        errorCode: error instanceof Error ? error.message : "rpc_failure",
      }).catch(() => undefined);
      throw error;
    }),
  ]);

  const graph = buildSnapshot(cohort.tokens, registry.assets, quoteEvidence.quotes);
  const onchainMultiplierBySymbol = new Map(chainEvidence.multiplierEvidence.map((item) => [item.symbol, item]));
  for (const habitat of graph.habitats) habitat.onchainMultiplier = onchainMultiplierBySymbol.get(habitat.symbol)?.onchain;
  await Promise.all(chainEvidence.multiplierEvidence.map((item) => item.verified
    ? resolveEngineAlert("multiplier_mismatch", "robinhood-asset", item.symbol)
    : recordEngineAlert({
        severity: "critical",
        code: "multiplier_mismatch",
        entityType: "robinhood-asset",
        entityId: item.symbol,
        message: `${item.symbol} REST and onchain UI multipliers disagree.`,
        evidence: { expected: item.expected, onchain: item.onchain, contract: item.contract },
      }))).catch(() => undefined);
  const dataConfidence = graph.species.length
    ? graph.species.reduce((sum, item) => sum + (item.metrics?.dataCompleteness ?? 0), 0) / graph.species.length
    : 0;
  const quoteCoverage = habitatSymbols.length ? quoteEvidence.quotes.size / habitatSymbols.length : 0;
  const engineConfidence = Math.round(
    dataConfidence * 0.35
    + (chainEvidence.reconciliation.confidence ?? 80) * 0.35
    + quoteCoverage * 100 * 0.15
    + (registry.assets.length ? 100 : 0) * 0.15,
  );
  for (const item of graph.species) {
    if (item.metrics) item.metrics.evidenceConfidence = Math.round(item.metrics.dataCompleteness * 0.55 + engineConfidence * 0.45);
  }
  await Promise.all(graph.species.flatMap((item) => {
    const tasks: Promise<unknown>[] = [];
    tasks.push((item.metrics?.marketStress ?? item.stress) >= 85
      ? recordEngineAlert({
          severity: "warning",
          code: "species_market_stress",
          entityType: "species",
          entityId: item.id,
          message: `${item.symbol} crossed the observed market-stress boundary.`,
          evidence: { stress: item.metrics?.marketStress ?? item.stress, depthRatio: item.metrics?.depthRatio, turnover24h: item.metrics?.turnover24h },
        })
      : resolveEngineAlert("species_market_stress", "species", item.id));
    tasks.push((item.metrics?.dataCompleteness ?? 0) < 88
      ? recordEngineAlert({
          severity: "warning",
          code: "species_evidence_incomplete",
          entityType: "species",
          entityId: item.id,
          message: `${item.symbol} is using one or more validated fallback metrics.`,
          evidence: { completeness: item.metrics?.dataCompleteness, source: item.marketDataSource },
        })
      : resolveEngineAlert("species_evidence_incomplete", "species", item.id));
    return tasks;
  })).catch(() => undefined);
  await (quoteEvidence.failures.length
    ? recordEngineAlert({
        severity: "warning",
        code: "habitat_quote_gap",
        entityType: "collector",
        entityId: "robinhood-prices",
        message: `${quoteEvidence.failures.length} selected habitat quotes were unavailable.`,
        evidence: { failures: quoteEvidence.failures },
      })
    : resolveEngineAlert("habitat_quote_gap", "collector", "robinhood-prices")).catch(() => undefined);

  const snapshot: AffinitySnapshot = {
    observedAt: sourceObservedAt,
    chain: "Robinhood Chain",
    ...graph,
    coverage: {
      discoveredSpecies: cohort.coverage.discoveredSpecies,
      observedSpecies: cohort.tokens.length,
      verifiedSpecies: chainEvidence.reconciliation.verifiedSpecies,
      excludedIncomplete: cohort.coverage.excludedIncomplete,
      activeHabitats: graph.habitats.length,
      cohortStrategy: "Top-market cohort with verified-habitat gating and two-cycle replacement hysteresis",
      registryAssets: registry.assets.length,
      quotedHabitats: quoteEvidence.quotes.size,
      confidence: engineConfidence,
    },
    block: affinitySnapshot.block,
  };
  const decision = deriveChainBlock(history, snapshot, latestBlock);
  snapshot.block = decision.block;
  const warnings = [
    ...(chainEvidence.reconciliation.degraded ? ["RPC quorum passed with one or more providers unavailable or disagreeing."] : []),
    ...(quoteEvidence.failures.length ? [`${quoteEvidence.failures.length} Robinhood habitat quote${quoteEvidence.failures.length === 1 ? "" : "s"} unavailable; graph topology remains verified.`] : []),
    ...(registry.stale ? ["Robinhood registry refresh failed; the last durable registry was used."] : []),
  ];
  const envelope: SnapshotEnvelope = {
    snapshot,
    meta: {
      mode: "live",
      generatedAt,
      sourceObservedAt,
      runId,
      engineConfidence,
      sources: [
        source("pair", "PAIR discovery + per-species metrics", "ok", sourceObservedAt, { recordCount: cohort.tokens.length }),
        source("robinhood", `Robinhood registry · ${registry.assets.length} active assets`, registry.stale ? "stale" : "ok", generatedAt, { recordCount: registry.assets.length }),
        source("robinhood-prices", `Robinhood quotes · ${quoteEvidence.quotes.size}/${habitatSymbols.length} habitats`, quoteEvidence.failures.length ? "stale" : "ok", generatedAt, { recordCount: quoteEvidence.quotes.size }),
        source(
          "robinhood-rpc",
          `Robinhood RPC quorum ${chainEvidence.reconciliation.quorum}/${chainEvidence.reconciliation.providerCount}`,
          chainEvidence.reconciliation.degraded ? "stale" : "ok",
          chainEvidence.reconciliation.observedAt,
          { recordCount: chainEvidence.reconciliation.verifiedSpecies },
        ),
      ],
      warnings,
      reconciliation: chainEvidence.reconciliation,
    },
  };

  await updateRunPhase(runId, "durable-commit", { engineConfidence, warnings: warnings.length });
  envelope.meta.ledger = await recordSnapshot(envelope, chainEvidence.reconciliation, chainEvidence.records, decision);
  return envelope;
}

export async function runAffinityCollection(trigger: CollectionTrigger, options: { force?: boolean } = {}) {
  const acquired = await acquireCollectionLease({ force: options.force });
  if (!acquired) return { status: "skipped" as const, reason: "fresh collection or active lease" };

  let run: Awaited<ReturnType<typeof startCollectionRun>> | null = null;
  let phase = "run-start";
  try {
    run = await startCollectionRun(trigger, "full");
    console.info("affinity collection started", { runId: run.id, trigger });
    phase = "collection";
    const envelope = await collectAffinitySnapshot(run.id);
    const snapshotId = envelope.meta.ledger?.snapshotId ?? null;
    await recordCollectionSuccess(snapshotId);
    await resolveEngineAlert("collection_failed", "collector", "affinity").catch(() => undefined);
    await completeCollectionRun(run.id, run.startedAt, {
      snapshotId,
      discoveredSpecies: envelope.snapshot.coverage?.discoveredSpecies ?? envelope.snapshot.species.length,
      observedSpecies: envelope.snapshot.species.length,
      verifiedSpecies: envelope.meta.reconciliation?.verifiedSpecies ?? 0,
      warningCount: envelope.meta.warnings.length,
      metadata: { engineConfidence: envelope.meta.engineConfidence, chainBlock: envelope.snapshot.block.number },
    });
    await Promise.all([pruneEngineHistory(), pruneSnapshotHistory()]).catch(() => undefined);
    console.info("affinity collection succeeded", { runId: run.id, snapshotId, species: envelope.snapshot.species.length });
    return { status: "recorded" as const, envelope };
  } catch (error) {
    const message = error instanceof Error ? error.message : "upstream validation failed";
    await recordCollectionFailure(message).catch(() => undefined);
    if (run) await failCollectionRun(run.id, run.startedAt, phase, error).catch(() => undefined);
    await recordEngineAlert({
      severity: "critical",
      code: "collection_failed",
      entityType: "collector",
      entityId: "affinity",
      message: `Collection failed during ${phase}: ${message.slice(0, 180)}`,
      evidence: { runId: run?.id, trigger, phase },
    }).catch(() => undefined);
    console.error("affinity collection failed", { runId: run?.id, trigger, phase, message });
    throw error;
  }
}

export async function runScheduledAffinityCollection() {
  return runAffinityCollection("scheduled");
}

export async function runRequestWatchdogCollection(force = false) {
  return runAffinityCollection(force ? "manual" : "request-watchdog", { force });
}

export async function serveAffinitySnapshot(): Promise<SnapshotEnvelope> {
  const generatedAt = new Date().toISOString();
  try {
    const durable = await loadLatestSnapshot("the newest collection is outside the live window");
    if (durable) return durable;
  } catch {
    // A truthful immutable reference remains available while D1 is cold or unavailable.
  }
  return referenceEnvelope(generatedAt, "No verified collection has reached the durable ledger yet");
}
