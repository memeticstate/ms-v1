import type { AdapterResult, Species, SpeciesMetrics } from "@/lib/affinity-model";

export type PairMarketPayload = { symbol: string; weightBps: number };

export type PairTokenPayload = {
  address: string;
  symbol: string;
  name: string;
  marketCapUsd: number;
  volumeUsd: number;
  liquidityUsd?: number;
  totalDepthUsd?: number;
  activeVirtualSwapDepthUsd?: number;
  priceUsd?: number;
  trades24h?: number;
  priceChange24h: number;
  graduated: boolean;
  rank?: number;
  launchedAt?: string;
  creator?: string;
  launchTxHash?: string;
  marketDataSource?: string;
  marketDataUpdatedAt?: string;
  markets: PairMarketPayload[];
};

function clamp(value: number, minimum = 0, maximum = 100) {
  return Math.max(minimum, Math.min(maximum, value));
}

function normalizedLog(value: number, scale: number) {
  return clamp((Math.log10(Math.max(0, value) + 1) / scale) * 100);
}

function observedMetrics(token: PairTokenPayload): SpeciesMetrics {
  const weights = token.markets.map((market) => market.weightBps / 10_000);
  const concentration = weights.reduce((sum, weight) => sum + weight * weight, 0);
  const maximumDiversity = token.markets.length > 1 ? 1 - (1 / token.markets.length) : 0;
  const diversity = maximumDiversity > 0 ? (1 - concentration) / maximumDiversity : 0;
  const affinityBalance = token.markets.length === 1 ? 62 : clamp(55 + diversity * 45);
  const turnover24h = token.marketCapUsd > 0 ? (token.volumeUsd / token.marketCapUsd) * 100 : 0;
  const depth = token.totalDepthUsd ?? token.liquidityUsd ?? 0;
  const depthRatio = token.marketCapUsd > 0 ? (depth / token.marketCapUsd) * 100 : 0;
  const flowScore = normalizedLog(token.volumeUsd, 7);
  const tradeScore = normalizedLog(token.trades24h ?? 0, 5);
  const depthScore = normalizedLog(depth, 6);
  const marketVitality = clamp(flowScore * 0.42 + tradeScore * 0.23 + depthScore * 0.25 + Math.min(turnover24h / 100, 3) / 3 * 10);
  const thinness = clamp(100 - depthRatio * 20);
  const volatility = clamp(Math.abs(token.priceChange24h) / 3);
  const velocityStress = clamp(Math.max(0, turnover24h - 35) * 0.35);
  const marketStress = clamp(thinness * 0.48 + volatility * 0.34 + velocityStress * 0.18);
  const fields = [
    token.marketCapUsd > 0,
    token.volumeUsd >= 0,
    depth > 0,
    token.priceUsd !== undefined,
    token.trades24h !== undefined,
    Boolean(token.marketDataUpdatedAt),
    token.markets.length > 0,
    Boolean(token.launchTxHash),
  ];
  const dataCompleteness = Math.round((fields.filter(Boolean).length / fields.length) * 100);
  return {
    version: "observed-v1",
    affinityBalance: Math.round(affinityBalance),
    marketVitality: Math.round(marketVitality),
    marketStress: Math.round(marketStress),
    turnover24h: Number(turnover24h.toFixed(2)),
    depthRatio: Number(depthRatio.toFixed(2)),
    dataCompleteness,
    evidenceConfidence: Math.round(dataCompleteness * 0.85),
  };
}

function narrative(token: PairTokenPayload) {
  const sorted = [...token.markets].sort((left, right) => right.weightBps - left.weightBps);
  const habitatNames = sorted.map((item) => item.symbol);
  if (sorted.length === 1) {
    return {
      thesis: `${token.symbol} expresses a concentrated affinity to ${habitatNames[0]}.`,
      interpretation: `A single-habitat species: every declared pool weight points to ${habitatNames[0]}. Market behavior is measured separately from that declared relationship.`,
    };
  }
  const equal = Math.max(...sorted.map((item) => item.weightBps)) - Math.min(...sorted.map((item) => item.weightBps)) <= 100;
  return {
    thesis: `${token.symbol} binds ${habitatNames.join(", ")} into one market organism.`,
    interpretation: equal
      ? `A balanced ${sorted.length}-habitat genome. No declared affinity dominates the species, so activity can be read against a diversified corporate terrain.`
      : `${sorted[0].symbol} is the dominant declared habitat at ${(sorted[0].weightBps / 100).toFixed(0)}%; the remaining weight distributes across ${habitatNames.slice(1).join(", ")}.`,
  };
}

export function normalizePairToken(
  token: PairTokenPayload,
  presentation: Pick<Species, "id" | "color" | "x" | "y"> & Partial<Pick<Species,
    "thesis" | "interpretation" | "coherence" | "vitality" | "stress"
  >>,
): AdapterResult {
  const metrics = observedMetrics(token);
  const copy = narrative(token);
  const species: Species = {
    ...presentation,
    thesis: presentation.thesis ?? copy.thesis,
    interpretation: presentation.interpretation
      ?? `${copy.interpretation} Observed 24h turnover is ${metrics.turnover24h.toFixed(1)}% with verified market depth equal to ${metrics.depthRatio.toFixed(1)}% of capitalization.`,
    symbol: token.symbol,
    name: token.name,
    sourceProtocol: "pair",
    sourceLabel: "PAIR V5",
    contract: token.address,
    marketCapUsd: token.marketCapUsd,
    observedVolumeUsd: token.volumeUsd,
    liquidityUsd: token.liquidityUsd,
    totalDepthUsd: token.totalDepthUsd,
    activeVirtualSwapDepthUsd: token.activeVirtualSwapDepthUsd,
    priceUsd: token.priceUsd,
    trades24h: token.trades24h,
    change24h: token.priceChange24h,
    coherence: metrics.affinityBalance,
    vitality: metrics.marketVitality,
    stress: metrics.marketStress,
    graduated: token.graduated,
    rank: token.rank,
    launchedAt: token.launchedAt,
    creator: token.creator,
    launchTxHash: token.launchTxHash,
    marketDataSource: token.marketDataSource,
    marketDataUpdatedAt: token.marketDataUpdatedAt,
    metrics,
    genome: token.markets.map((market) => ({ habitat: market.symbol, weight: market.weightBps / 100 })),
  };

  const edges = token.markets.map((market) => ({
    id: `${presentation.id}-${market.symbol}`,
    speciesId: presentation.id,
    habitat: market.symbol,
    sourceProtocol: "pair" as const,
    declaredWeight: market.weightBps / 100,
    strength: market.weightBps / 100,
    confidence: metrics.dataCompleteness,
  }));

  return { species, edges };
}
