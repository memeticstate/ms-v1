import type { AffinitySnapshot, ChainBlock, ChainBlockDriver } from "@/lib/affinity-model";

export const INTERPRETATION_ENGINE_VERSION = "deterministic-evidence-v2";

export const CHAIN_BLOCK_THRESHOLDS = {
  affinityWeightPoints: 5,
  marketCapPercent: 25,
  volumePercent: 50,
  rollingMarketCapPercent: 15,
  rollingVolumePercent: 35,
  minimumRollingWindow: 3,
} as const;

export type ChainBlockKind = "genesis" | "topology" | "affinity" | "market" | "integrity";

export type SnapshotRecord = {
  snapshotId: string;
  snapshot: AffinitySnapshot;
};

export type ChainBlockProvenance = {
  engineVersion: string;
  previousSnapshotId: string | null;
  baselineSnapshotId?: string | null;
  previousObservedAt: string | null;
  currentObservedAt: string;
  windowSnapshotIds: string[];
  thresholds: typeof CHAIN_BLOCK_THRESHOLDS;
  metrics: Record<string, unknown>;
};

export type ChainBlockDecision = {
  meaningful: boolean;
  kind: ChainBlockKind | null;
  significance: number;
  block: ChainBlock;
  previousSnapshotId: string | null;
  provenance: ChainBlockProvenance;
};

function percentDelta(previous: number, current: number) {
  if (previous === 0) return current === 0 ? 0 : 100;
  return ((current - previous) / Math.abs(previous)) * 100;
}

function median(values: number[]) {
  if (!values.length) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function signed(value: number, digits = 1) {
  return `${value >= 0 ? "+" : ""}${value.toFixed(digits)}%`;
}

function dateLabel(value: string) {
  return new Intl.DateTimeFormat("en-GB", {
    day: "2-digit", month: "short", year: "numeric", timeZone: "UTC",
  }).format(new Date(value)).toUpperCase();
}

function sortedUnique(values: string[]) {
  return [...new Set(values)].sort();
}

function edgeKey(edge: AffinitySnapshot["edges"][number]) {
  return `${edge.speciesId}:${edge.habitat}`;
}

function topologyDriver(previous: AffinitySnapshot, current: AffinitySnapshot): ChainBlockDriver | null {
  const previousSpecies = new Set(previous.species.map((item) => item.id));
  const currentSpecies = new Set(current.species.map((item) => item.id));
  const addedSpecies = [...currentSpecies].filter((id) => !previousSpecies.has(id));
  const removedSpecies = [...previousSpecies].filter((id) => !currentSpecies.has(id));
  const previousEdges = new Set(previous.edges.map(edgeKey));
  const currentEdges = new Set(current.edges.map(edgeKey));
  const addedEdges = [...currentEdges].filter((key) => !previousEdges.has(key));
  const removedEdges = [...previousEdges].filter((key) => !currentEdges.has(key));
  if (!addedSpecies.length && !removedSpecies.length && !addedEdges.length && !removedEdges.length) return null;
  return {
    kind: "topology",
    label: "Verified graph topology changed",
    score: 100,
    significance: 100,
    summary: `${addedSpecies.length} species and ${addedEdges.length} affinity links entered; ${removedSpecies.length} species and ${removedEdges.length} links retired.`,
    speciesIds: sortedUnique([
      ...addedSpecies,
      ...removedSpecies,
      ...addedEdges.map((key) => key.split(":")[0]),
      ...removedEdges.map((key) => key.split(":")[0]),
    ]),
    evidence: [
      { label: "Species in", value: String(addedSpecies.length) },
      { label: "Species out", value: String(removedSpecies.length) },
      { label: "Edges in", value: String(addedEdges.length) },
      { label: "Edges out", value: String(removedEdges.length) },
    ],
  };
}

function affinityDrivers(previous: AffinitySnapshot, current: AffinitySnapshot) {
  const prior = new Map(previous.edges.map((edge) => [edgeKey(edge), edge]));
  return current.edges.flatMap((edge): ChainBlockDriver[] => {
    const previousEdge = prior.get(edgeKey(edge));
    if (!previousEdge) return [];
    const shift = (edge.declaredWeight ?? edge.strength) - (previousEdge.declaredWeight ?? previousEdge.strength);
    if (Math.abs(shift) < CHAIN_BLOCK_THRESHOLDS.affinityWeightPoints) return [];
    const species = current.species.find((item) => item.id === edge.speciesId);
    return [{
      kind: "affinity",
      label: `${species?.symbol ?? edge.speciesId} rewrote ${edge.habitat} affinity`,
      score: Math.min(100, Math.round(Math.abs(shift) * 10)),
      significance: Math.min(100, Math.round(Math.abs(shift) * 10)),
      summary: `Declared ${edge.habitat} weight moved ${shift >= 0 ? "+" : ""}${shift.toFixed(1)} points against a ${CHAIN_BLOCK_THRESHOLDS.affinityWeightPoints}-point boundary.`,
      speciesIds: [edge.speciesId],
      evidence: [
        { label: "Species", value: species?.symbol ?? edge.speciesId },
        { label: "Habitat", value: edge.habitat },
        { label: "Weight shift", value: `${shift >= 0 ? "+" : ""}${shift.toFixed(1)} pt` },
        { label: "Boundary", value: `≥${CHAIN_BLOCK_THRESHOLDS.affinityWeightPoints} pt` },
      ],
    }];
  });
}

function marketDrivers(history: SnapshotRecord[], current: AffinitySnapshot) {
  const previous = history[0]?.snapshot;
  if (!previous) return [];
  const previousSpecies = new Map(previous.species.map((item) => [item.id, item]));
  return current.species.flatMap((species): ChainBlockDriver[] => {
    const prior = previousSpecies.get(species.id);
    if (!prior) return [];
    const immediateMarketCap = percentDelta(prior.marketCapUsd, species.marketCapUsd);
    const immediateVolume = percentDelta(prior.observedVolumeUsd, species.observedVolumeUsd);
    const historical = history.flatMap((record) => {
      const item = record.snapshot.species.find((candidate) => candidate.id === species.id);
      return item ? [item] : [];
    });
    const baselineMarketCap = median(historical.map((item) => item.marketCapUsd));
    const baselineVolume = median(historical.map((item) => item.observedVolumeUsd));
    const rollingMarketCap = percentDelta(baselineMarketCap, species.marketCapUsd);
    const rollingVolume = percentDelta(baselineVolume, species.observedVolumeUsd);
    const immediateCrossed = Math.abs(immediateMarketCap) >= CHAIN_BLOCK_THRESHOLDS.marketCapPercent
      || Math.abs(immediateVolume) >= CHAIN_BLOCK_THRESHOLDS.volumePercent;
    const rollingCrossed = historical.length >= CHAIN_BLOCK_THRESHOLDS.minimumRollingWindow
      && (Math.abs(rollingMarketCap) >= CHAIN_BLOCK_THRESHOLDS.rollingMarketCapPercent
        || Math.abs(rollingVolume) >= CHAIN_BLOCK_THRESHOLDS.rollingVolumePercent);
    if (!immediateCrossed && !rollingCrossed) return [];
    const immediateScore = Math.max(
      Math.abs(immediateMarketCap) / CHAIN_BLOCK_THRESHOLDS.marketCapPercent,
      Math.abs(immediateVolume) / CHAIN_BLOCK_THRESHOLDS.volumePercent,
    );
    const rollingScore = rollingCrossed ? Math.max(
      Math.abs(rollingMarketCap) / CHAIN_BLOCK_THRESHOLDS.rollingMarketCapPercent,
      Math.abs(rollingVolume) / CHAIN_BLOCK_THRESHOLDS.rollingVolumePercent,
    ) : 0;
    return [{
      kind: "market",
      label: `${species.symbol} entered a new market regime`,
      score: Math.min(100, Math.round(Math.max(immediateScore, rollingScore) * 50)),
      significance: Math.min(100, Math.round(Math.max(immediateScore, rollingScore) * 50)),
      summary: `Market cap moved ${signed(immediateMarketCap)} and observed flow ${signed(immediateVolume)}; rolling median deviations were ${signed(rollingMarketCap)} and ${signed(rollingVolume)}.`,
      speciesIds: [species.id],
      evidence: [
        { label: "Market cap delta", value: signed(immediateMarketCap) },
        { label: "Volume delta", value: signed(immediateVolume) },
        { label: `${historical.length}-state cap`, value: signed(rollingMarketCap) },
        { label: `${historical.length}-state flow`, value: signed(rollingVolume) },
      ],
    }];
  });
}

function confidence(current: AffinitySnapshot, windowSize: number) {
  const speciesConfidence = current.species.length
    ? current.species.reduce((sum, item) => sum + (item.metrics?.evidenceConfidence ?? item.metrics?.dataCompleteness ?? 80), 0) / current.species.length
    : 0;
  const coverageConfidence = current.coverage?.confidence ?? speciesConfidence;
  const historyConfidence = Math.min(100, 60 + windowSize * 5);
  return Math.round(coverageConfidence * 0.65 + historyConfidence * 0.35);
}

function priority(driver: ChainBlockDriver) {
  return driver.kind === "topology" ? 4 : driver.kind === "affinity" ? 3 : driver.kind === "market" ? 2 : 1;
}

export function deriveChainBlock(
  previousOrHistory: SnapshotRecord | SnapshotRecord[] | null,
  current: AffinitySnapshot,
  latestBlock: ChainBlock | null,
  legacyRollingBaseline?: SnapshotRecord | null,
): ChainBlockDecision {
  const history = Array.isArray(previousOrHistory)
    ? previousOrHistory
    : previousOrHistory
      ? [previousOrHistory, ...(legacyRollingBaseline && legacyRollingBaseline.snapshotId !== previousOrHistory.snapshotId ? [legacyRollingBaseline] : [])]
      : [];
  const previous = history[0] ?? null;
  const baseline = history.at(-1) ?? null;
  const baseProvenance: Omit<ChainBlockProvenance, "metrics"> = {
    engineVersion: INTERPRETATION_ENGINE_VERSION,
    previousSnapshotId: previous?.snapshotId ?? null,
    baselineSnapshotId: baseline?.snapshotId ?? null,
    previousObservedAt: previous?.snapshot.observedAt ?? null,
    currentObservedAt: current.observedAt,
    windowSnapshotIds: history.map((record) => record.snapshotId),
    thresholds: CHAIN_BLOCK_THRESHOLDS,
  };
  const engineConfidence = confidence(current, history.length);

  if (!previous) {
    const block: ChainBlock = {
      number: (latestBlock?.number ?? 0) + 1,
      date: dateLabel(current.observedAt),
      kind: "genesis",
      significance: 100,
      confidence: engineConfidence,
      engineVersion: INTERPRETATION_ENGINE_VERSION,
      windowSize: 0,
      window: "Genesis baseline",
      previousObservedAt: null,
      title: "The verified graph begins",
      signal: `${current.species.length} species and ${current.edges.length} affinity links entered the durable record.`,
      interpretation: "This is the reconciled baseline. Later Chain Blocks require a topology, declared-affinity, or market-regime boundary to be crossed.",
      evidence: [
        { label: "Species", value: String(current.species.length) },
        { label: "Affinity links", value: String(current.edges.length) },
        { label: "Habitats", value: String(current.habitats.length) },
        { label: "Confidence", value: `${engineConfidence}%` },
      ],
      speciesIds: current.species.map((item) => item.id).sort(),
      drivers: [],
    };
    return {
      meaningful: true,
      kind: "genesis",
      significance: 100,
      block,
      previousSnapshotId: null,
      provenance: { ...baseProvenance, metrics: { species: current.species.length, edges: current.edges.length, engineConfidence } },
    };
  }

  const drivers = [
    topologyDriver(previous.snapshot, current),
    ...affinityDrivers(previous.snapshot, current),
    ...marketDrivers(history, current),
  ].filter((driver): driver is ChainBlockDriver => driver !== null)
    .sort((left, right) => priority(right) - priority(left) || right.score - left.score || left.label.localeCompare(right.label));

  if (!drivers.length) {
    return {
      meaningful: false,
      kind: null,
      significance: 0,
      block: latestBlock ?? previous.snapshot.block,
      previousSnapshotId: previous.snapshotId,
      provenance: { ...baseProvenance, metrics: { outcome: "below-materiality-thresholds", engineConfidence, windowSize: history.length } },
    };
  }

  const dominant = drivers[0];
  const significance = dominant.kind === "topology" ? 100 : Math.min(100, Math.round(dominant.score * 0.8 + median(drivers.map((item) => item.score)) * 0.2));
  const speciesIds = sortedUnique(drivers.flatMap((driver) => driver.speciesIds));
  const evidence = [
    ...dominant.evidence.slice(0, 2),
    { label: "Concurrent drivers", value: String(drivers.length) },
    { label: "Confidence", value: `${engineConfidence}%` },
  ];
  const signal = dominant.kind === "market"
    ? `${dominant.evidence[0].value.startsWith("+") || dominant.evidence[0].value.startsWith("-")
      ? current.species.find((item) => dominant.speciesIds.includes(item.id))?.symbol ?? dominant.speciesIds[0]
      : dominant.speciesIds[0]} market cap moved ${dominant.evidence[0].value} while observed volume moved ${dominant.evidence[1].value}.`
    : dominant.kind === "affinity"
      ? `${dominant.evidence[0].value} moved ${dominant.evidence[2].value} at ${dominant.evidence[1].value}.`
      : `${dominant.evidence[2].value} affinity links entered and ${dominant.evidence[3].value} retired across the verified graph.`;
  const block: ChainBlock = {
    number: Math.max(latestBlock?.number ?? 0, previous.snapshot.block.number ?? 0) + 1,
    date: dateLabel(current.observedAt),
    kind: dominant.kind,
    significance,
    confidence: engineConfidence,
    engineVersion: INTERPRETATION_ENGINE_VERSION,
    windowSize: history.length,
    window: `${history.length}-snapshot rolling evidence window`,
    previousObservedAt: previous.snapshot.observedAt,
    title: dominant.label,
    signal,
    interpretation: drivers.length > 1
      ? `${drivers.length} independent deterministic drivers crossed materiality boundaries in the same verified state. The dominant driver names the block; all drivers remain attached as evidence.`
      : `The ${dominant.kind} driver crossed its published boundary against immediate and rolling historical evidence. No language-model judgment is used to mint this block.`,
    evidence,
    speciesIds,
    drivers,
  };
  return {
    meaningful: true,
    kind: dominant.kind,
    significance,
    block,
    previousSnapshotId: previous.snapshotId,
    provenance: {
      ...baseProvenance,
      metrics: {
        engineConfidence,
        windowSize: history.length,
        driverCount: drivers.length,
        drivers: drivers.map((driver) => ({ kind: driver.kind, label: driver.label, score: driver.score, speciesIds: driver.speciesIds })),
      },
    },
  };
}
