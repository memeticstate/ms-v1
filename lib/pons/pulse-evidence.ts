export const pulseLabels = { trades: "Curve trades", actors: "Distinct actors", launches: "New launches", graduations: "Graduations" } as const;
export type PulseMetricKey = keyof typeof pulseLabels;
export type PulseSelection = { metric: PulseMetricKey; toBlock: number; displayedCount: number };
export type PulseEvidenceRow = {
  id: string; address: string; symbol: string | null; pair: string | null; block: number;
  timestamp: number; txHash: string | null; action: string; trades: number | null; tokens: number | null;
};
export type PulseEvidenceResponse = {
  metric: PulseMetricKey; fromBlock: number; toBlock: number; total: number; offset: number; hasMore: boolean; rows: PulseEvidenceRow[];
};
