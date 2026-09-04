import type { PonsStateResponse } from "@/lib/pons/model";

export type PremiumInterpretation = {
  headline: string;
  readout: string;
  observations: string[];
  watchpoints: string[];
  confidence: "high" | "measured" | "early";
  throughBlock: number;
  generatedAt: string;
};

function direction(metric: PonsStateResponse["pulse"]["trades"]) {
  if (metric.changePercent === null) return metric.current > 0 ? "new activity" : "no change";
  if (metric.changePercent > 5) return "expanding";
  if (metric.changePercent < -5) return "contracting";
  return "steady";
}

function formatPercent(value: number | null) {
  if (value === null) return "not yet comparable";
  return `${value >= 0 ? "+" : ""}${value.toFixed(1)}%`;
}

export function derivePremiumInterpretation(state: PonsStateResponse): PremiumInterpretation {
  const leader = state.pulse.leader;
  const confidence = state.pulse.status === "verified" && state.integrity.pulseReconciled
    ? "high"
    : state.pulse.status === "delayed" || state.mode === "degraded" ? "measured" : "early";
  const headline = leader
    ? `${leader.tokenSymbol} is the clearest attention cluster in this window.`
    : "The current window is still forming a clear attention cluster.";
  const readout = leader
    ? `${leader.pairSymbol} is carrying the most observed curve activity, with ${leader.recentTrades.toLocaleString()} recent trades. Read this as participation context, not a price or quality signal.`
    : "Activity is visible, but the current window does not yet support a responsible leader call. Wait for another verified interval before drawing a stronger interpretation.";
  const observations = [
    `Curve activity is ${direction(state.pulse.trades)} at ${state.pulse.trades.current.toLocaleString()} trades (${formatPercent(state.pulse.trades.changePercent)} versus the prior window).`,
    `${state.pulse.uniqueTraders.current.toLocaleString()} distinct actors are visible; breadth is ${direction(state.pulse.uniqueTraders)}.`,
    `${state.pulse.launches.current.toLocaleString()} launches and ${state.pulse.graduations.current.toLocaleString()} graduations were observed in the same interval.`,
  ];
  const watchpoints = [
    state.index.liveLagBlocks > 10_000
      ? `Index freshness is the main constraint: ${state.index.liveLagBlocks.toLocaleString()} blocks remain between the live edge and the indexed view.`
      : "Index freshness is within the normal observation boundary.",
    state.coverage.metadataPercent < 95
      ? `Identity coverage is ${state.coverage.metadataPercent.toFixed(1)}%; unresolved names should be treated as provisional.`
      : "Identity coverage is strong enough for the current readout.",
    state.integrity.pulseReconciled
      ? "Pulse totals reconcile across the materialized cohort and protocol views."
      : "Pulse totals are not fully reconciled; keep this interpretation provisional.",
  ];
  return {
    headline,
    readout,
    observations,
    watchpoints,
    confidence,
    throughBlock: state.index.latestIndexedBlock,
    generatedAt: state.generatedAt,
  };
}
