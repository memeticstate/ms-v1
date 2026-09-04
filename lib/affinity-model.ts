export type ProtocolId = "pair" | "pons" | "uniswap-v4" | "native";

export type Habitat = {
  symbol: string;
  name: string;
  sector: string;
  color: string;
  x: number;
  y: number;
  contract?: string;
  assetUid?: string;
  currentMultiplier?: string;
  onchainMultiplier?: string;
  pendingMultiplier?: string;
  pendingEffectiveAt?: string;
  tradingStatus?: string;
  logoUrl?: string;
  quote?: RobinhoodQuote;
};

export type Gene = { habitat: string; weight: number };

export type SpeciesMetrics = {
  version: "observed-v1" | "reference";
  affinityBalance: number;
  marketVitality: number;
  marketStress: number;
  turnover24h: number;
  depthRatio: number;
  dataCompleteness: number;
  evidenceConfidence?: number;
};

export type Species = {
  id: string;
  symbol: string;
  name: string;
  thesis: string;
  interpretation: string;
  sourceProtocol: ProtocolId;
  sourceLabel: string;
  contract: string;
  marketCapUsd: number;
  observedVolumeUsd: number;
  liquidityUsd?: number;
  totalDepthUsd?: number;
  activeVirtualSwapDepthUsd?: number;
  priceUsd?: number;
  trades24h?: number;
  change24h: number;
  coherence: number;
  vitality: number;
  stress: number;
  graduated: boolean;
  color: string;
  x: number;
  y: number;
  genome: Gene[];
  rank?: number;
  launchedAt?: string;
  creator?: string;
  launchTxHash?: string;
  marketDataSource?: string;
  marketDataUpdatedAt?: string;
  metrics?: SpeciesMetrics;
};

export type AffinityEdge = {
  id: string;
  speciesId: string;
  habitat: string;
  sourceProtocol: ProtocolId;
  declaredWeight?: number;
  strength: number;
  confidence?: number;
};

export type ChainBlockDriver = {
  kind: "topology" | "affinity" | "market" | "integrity";
  label: string;
  score: number;
  significance: number;
  summary: string;
  speciesIds: string[];
  evidence: { label: string; value: string }[];
};

export type ChainBlock = {
  number: number;
  date: string;
  kind?: "genesis" | "topology" | "affinity" | "market" | "integrity";
  significance?: number;
  confidence?: number;
  engineVersion?: string;
  windowSize?: number;
  window?: string;
  previousObservedAt?: string | null;
  title: string;
  signal: string;
  interpretation: string;
  evidence: { label: string; value: string }[];
  speciesIds: string[];
  drivers?: ChainBlockDriver[];
};

export type SnapshotCoverage = {
  discoveredSpecies: number;
  observedSpecies: number;
  verifiedSpecies: number;
  excludedIncomplete: number;
  activeHabitats: number;
  cohortStrategy: string;
  registryAssets?: number;
  quotedHabitats?: number;
  confidence?: number;
};

export type AffinitySnapshot = {
  observedAt: string;
  chain: string;
  habitats: Habitat[];
  species: Species[];
  edges: AffinityEdge[];
  block: ChainBlock;
  coverage?: SnapshotCoverage;
};

export type SnapshotMode = "live" | "cached" | "reference";

export type SnapshotSource = {
  id: "pair" | "robinhood" | "robinhood-prices" | "robinhood-actions" | "robinhood-rpc";
  label: string;
  status: "ok" | "stale" | "failed";
  observedAt?: string;
  latencyMs?: number;
  recordCount?: number;
};

export type SnapshotReconciliation = {
  status: "verified";
  chainId: number;
  blockNumber: number;
  blockHash: string;
  observedAt: string;
  verifiedSpecies: number;
  totalSpecies: number;
  providerCount: number;
  quorum: number;
  degraded: boolean;
  confidence?: number;
  attestationsReused?: number;
  multiplierVerified?: number;
};

export type RpcProviderObservation = {
  provider: string;
  status: "healthy" | "disagreeing" | "failed";
  observedAt: string;
  latencyMs: number;
  blockNumber?: number;
  blockHash?: string;
  errorCode?: string;
};

export type SnapshotLedger = {
  snapshotId: string;
  position: number;
  recordedAt: string;
  chainBlockId?: string;
};

export type CollectionRunSummary = {
  id: string;
  trigger: string;
  lane: string;
  status: "running" | "succeeded" | "failed" | "skipped";
  phase: string;
  startedAt: string;
  completedAt?: string | null;
  durationMs?: number | null;
  snapshotId?: string | null;
  discoveredSpecies: number;
  observedSpecies: number;
  verifiedSpecies: number;
  warningCount: number;
  errorCode?: string | null;
};

export type SourceHealth = {
  source: string;
  status: "ok" | "stale" | "failed";
  observedAt: string;
  latencyMs: number;
  freshnessMs?: number | null;
  recordCount: number;
  errorCode?: string | null;
};

export type EngineAlert = {
  id: string;
  detectedAt: string;
  severity: "info" | "warning" | "critical";
  code: string;
  entityType: string;
  entityId: string;
  message: string;
};

export type CollectionHealth = {
  status: "pending" | "collecting" | "healthy" | "degraded";
  cadenceMinutes: number;
  lastAttemptAt?: string | null;
  lastSuccessAt?: string | null;
  lastFailureAt?: string | null;
  lastSnapshotId?: string | null;
  lastErrorCode?: string | null;
  consecutiveFailures?: number;
  staleForMs?: number | null;
  latestRun?: CollectionRunSummary | null;
};

export type EngineHealth = {
  status: "pending" | "healthy" | "degraded" | "critical";
  score: number;
  collection: CollectionHealth;
  sources: SourceHealth[];
  alerts: EngineAlert[];
  archive: { snapshots: number; speciesObservations: number; chainBlocks: number };
  registry: { assets: number; lastObservedAt?: string | null; quotedHabitats: number };
};

export type AffinityHealth = {
  providers: RpcProviderObservation[];
  recentDisagreements?: number;
  recentFailures?: number;
  collection?: CollectionHealth;
  engine?: EngineHealth;
  error?: string;
};

export type RobinhoodQuote = {
  symbol: string;
  bid: number;
  ask: number;
  mid: number;
  spreadBps: number;
  dailyVolume?: number;
  halted: boolean;
  generatedAt: string;
  currentMultiplier?: string;
  tokenBid?: number;
  tokenAsk?: number;
  freshnessMs: number;
};

export type SnapshotEnvelope = {
  snapshot: AffinitySnapshot;
  meta: {
    mode: SnapshotMode;
    generatedAt: string;
    sourceObservedAt?: string;
    sources: SnapshotSource[];
    warnings: string[];
    reconciliation?: SnapshotReconciliation;
    ledger?: SnapshotLedger;
    runId?: string;
    engineConfidence?: number;
  };
};

export type AdapterResult = {
  species: Species;
  edges: AffinityEdge[];
};
