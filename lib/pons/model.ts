export type PonsIndexMode = "live" | "indexing" | "empty" | "degraded";

export type PonsActivitySignal = "surging" | "broadening" | "forming" | "steady" | "cooling" | "quiet";
export type PonsSignalConfidence = "high" | "medium" | "early";

export type PonsPulseMetric = {
  current: number;
  previous: number;
  changePercent: number | null;
};

export type PonsPairCohort = {
  symbol: string;
  address: string;
  color: string;
  kind: "native" | "stable" | "stock" | "unknown";
  launches: number;
  uniqueDeployers: number;
  trades: number;
  uniqueTraders: number;
  buys: number;
  sells: number;
  graduations: number;
  topDeployerShare: number;
  recentTrades: number;
  previousTrades: number;
  recentUniqueTraders: number;
  momentumPercent: number | null;
  buyShare: number;
  graduationRate: number;
  signal: PonsActivitySignal;
  signalNote: string;
  attentionScore: number;
};

export type PonsLaunchView = {
  tokenAddress: string;
  curveAddress: string;
  deployerAddress: string;
  pairTokenAddress: string;
  pairSymbol: string;
  pairColor: string;
  name: string;
  symbol: string;
  blockNumber: number;
  launchedAt: string;
  txHash: string;
  launchConfigId: number;
  graduationThresholdRaw: string;
  phase: "bonding" | "graduated" | "swept";
  trades: number;
  buys: number;
  sells: number;
  uniqueTraders: number;
  recentTrades: number;
  previousTrades: number;
  recentUniqueTraders: number;
  recentBuys: number;
  recentSells: number;
  momentumPercent: number | null;
  buyShare: number;
  signal: PonsActivitySignal;
  signalNote: string;
  confidence: PonsSignalConfidence;
  flowQuality: number;
  attentionScore: number;
  deployerLaunches: number;
  deployerGraduations: number;
};

export type PonsTapeEvent = {
  id: string;
  eventType: "launch" | "graduation" | "sweep" | "permanent-lock";
  tokenAddress: string;
  tokenSymbol: string;
  pairSymbol: string;
  blockNumber: number;
  observedAt: string;
  txHash: string;
  detail: string;
};

export type PonsActivityPoint = {
  observedAt: string;
  indexedBlock: number;
  headBlock: number;
  lagBlocks: number;
  launches: number;
  graduations: number;
  buys: number;
  sells: number;
  activeDeployers: number;
  activeTraders: number;
};

export type PonsMemoryMetric = {
  current: number;
  baseline: number | null;
  changePercent: number | null;
  multiple: number | null;
};

export type PonsMemoryHorizon = {
  id: "8m" | "1h" | "6h" | "24h" | "7d";
  label: string;
  targetMinutes: number;
  elapsedMinutes: number | null;
  status: "ready" | "warming";
  baselineObservedAt: string | null;
  trades: PonsMemoryMetric;
  activeTraders: PonsMemoryMetric;
  launches: PonsMemoryMetric;
  graduations: PonsMemoryMetric;
  leader: {
    current: string | null;
    baseline: string | null;
    changed: boolean;
  };
};

export type PonsProtocolGeneration = {
  id: "v2" | "v1-current" | "v1-legacy";
  label: string;
  mechanism: string;
  factory: string;
  startBlock: number;
  status: "deep" | "registry" | "queued" | "indexing" | "complete";
  dataDepth: string;
  indexedThroughBlock: number | null;
  historicalProgress: number;
  rankingEligible: boolean;
  launchesIndexed?: number;
  swapsIndexed?: number;
  launchProgress?: number;
  swapProgress?: number;
};

export type PonsHistoricalLaunch = {
  generation: "v1-current" | "v1-legacy";
  mechanism: "Uniswap V3 from block one";
  tokenAddress: string;
  deployerAddress: string;
  pairTokenAddress: string;
  pairSymbol: string;
  venueAddress: string;
  name: string;
  symbol: string;
  blockNumber: number;
  launchedAt: string;
  txHash: string;
  swaps: number;
  buys: number;
  sells: number;
  uniqueTraders: number;
};

export type PonsProtocolHistory = {
  generations: Array<{
    id: "v1-current" | "v1-legacy";
    factory: string;
    startBlock: number;
    latestSeenBlock: number;
    launchIndexedThroughBlock: number;
    swapIndexedThroughBlock: number;
    launchProgress: number;
    swapProgress: number;
    launches: number;
    swaps: number;
    lastSuccessAt: string | null;
    lastErrorCode: string | null;
    consecutiveFailures: number;
  }>;
  launchCount: number;
  swapCount: number;
  recent: PonsHistoricalLaunch[];
  finalityBlocks: number;
};

export type PonsStateResponse = {
  mode: PonsIndexMode;
  generatedAt: string;
  window: {
    fromBlock: number;
    toBlock: number;
    blocks: number;
    approximateHours: number;
  };
  pulse: {
    windowBlocks: number;
    approximateMinutes: number;
    status: "verified" | "delayed" | "warming";
    launches: PonsPulseMetric;
    trades: PonsPulseMetric;
    uniqueTraders: PonsPulseMetric;
    graduations: PonsPulseMetric;
    leader: {
      tokenAddress: string;
      tokenSymbol: string;
      pairSymbol: string;
      recentTrades: number;
    } | null;
  };
  integrity: {
    status: "reconciled" | "mismatch";
    committedThroughBlock: number;
    protocolRecentTrades: number;
    cohortRecentTrades: number;
    pulseReconciled: boolean;
  };
  summary: {
    launches: number;
    graduations: number;
    trades: number;
    uniqueDeployers: number;
    uniqueTraders: number;
    stockPairs: number;
  };
  coverage: {
    metadataResolved: number;
    metadataPending: number;
    metadataFailed: number;
    metadataPercent: number;
    visibleLaunches: number;
  };
  protocolCoverage?: {
    canonicalGenerations: number;
    deeplyIndexedGenerations: number;
    rankingScope: string;
    generations: PonsProtocolGeneration[];
  };
  history?: PonsProtocolHistory;
  collector: {
    status: "running" | "succeeded" | "failed" | "idle";
    phase: string;
    strategy: "balanced" | "live-catchup" | null;
    startedAt: string | null;
    completedAt: string | null;
    durationMs: number | null;
    warningCount: number;
    errorCode: string | null;
    liveBlocksProcessed: number;
    historicalBlocksProcessed: number;
    recordsProcessed: number;
    metadataResolved: number;
  };
  cohorts: PonsPairCohort[];
  launches: PonsLaunchView[];
  tape: PonsTapeEvent[];
  activity: PonsActivityPoint[];
  memory: {
    observationWindowBlocks: number;
    currentThroughBlock: number;
    horizons: PonsMemoryHorizon[];
  };
  flagship: {
    pair: "NVDA";
    thesis: string;
    cohort: PonsPairCohort | null;
  };
  index: {
    factory: string;
    latestSeenBlock: number;
    latestIndexedBlock: number;
    liveLagBlocks: number;
    backfillNextBlock: number;
    backfillFloor: number;
    historicalProgress: number;
    lastSuccessAt: string | null;
    consecutiveFailures: number;
    source: string;
    finalityBlocks: number;
    velocity: {
      indexedBlocksPerMinute: number | null;
      chainBlocksPerMinute: number | null;
      netCatchupPerMinute: number | null;
      estimatedCatchupMinutes: number | null;
      trend: "closing" | "flat" | "widening" | "warming";
    };
  };
  methodology: {
    scoreVersion: string;
    windowBlocks: number;
    caveats: string[];
  };
};
