import type { PonsLaunchView, PonsResearchReading, PonsStateResponse, PonsTokenEvidence } from "./model";

export const RESEARCH_VERSION = "pons-evidence-v4";
export const MAX_SIGNAL_LAG_BLOCKS = 3_000;
export const MAX_STATE_AGE_MS = 2 * 60_000;
export const MAX_HOLDER_AGE_MS = 10 * 60_000;
export const MIN_PULSE_TRADES = 12;
export const MIN_PULSE_ACTORS = 5;
export const MIN_MEANINGFUL_HOLDERS = 10;
const age = (value: string | null | undefined, now: number) => value && Number.isFinite(Date.parse(value)) && Date.parse(value) <= now + 30_000 ? Math.max(0, now - Date.parse(value)) : Infinity;

export function currentPonsEvidence(state: PonsStateResponse, now = Date.now()) {
  return state.mode !== "empty" && state.mode !== "degraded"
    && state.index.consecutiveFailures === 0 && state.collector.status !== "failed"
    && state.integrity.pulseReconciled && state.index.liveLagBlocks <= MAX_SIGNAL_LAG_BLOCKS
    && age(state.generatedAt, now) <= MAX_STATE_AGE_MS
    && age(state.index.lastSuccessAt, now) <= MAX_STATE_AGE_MS;
}

export function assessLaunch(launch: PonsLaunchView, fresh: boolean, now = Date.now()): PonsResearchReading {
  const evidence = launch.currentEvidence;
  const result = (signal: PonsResearchReading["signal"], label: string, reasons: string[], next: string, score: number | null = null): PonsResearchReading => ({
    signal, label, reasons, next, score, eligible: score !== null, observedAt: launch.lastTradeAt ?? null,
  });
  // Ownership has its own observation clock. Fresh depletion evidence remains
  // meaningful even when the historical trading lane is delayed.
  if (evidence?.observedAt && age(evidence.observedAt, now) <= MAX_HOLDER_AGE_MS && evidence.reserveSharePercent !== null && evidence.reserveSharePercent >= 99) {
    return result("inactive", "Participation depleted", [
      `${evidence.reserveSharePercent.toFixed(2)}% of supply is currently in identified reserve contracts.`,
      "Historical trades do not demonstrate retained participation. This record is excluded from the current shortlist.",
      ...(!fresh ? ["Trading coverage is delayed; the ownership observation above has its own timestamp."] : []),
    ], "Keep this in the archive. Re-entry requires fresh trading, retained ownership, and a new assessment; no recovery is presumed.");
  }
  if (!fresh) return result("historical", "Historical activity", [
    `${launch.recentTrades} trades were recorded across ${launch.recentUniqueTraders} actor addresses in the indexed pulse. The index is not current enough to describe activity now.`,
    "Current attention and momentum classifications are withheld. A recent collector attempt does not make old blocks live.",
  ], "Open the current chart and holder distribution before drawing a conclusion. This historical record is excluded from current signals.");

  if (launch.phase !== "bonding") return result("unverified", "Pool activity unverified", [
    `This token ${launch.phase === "graduated" ? "graduated" : "left its curve"}; the indexed trades cover the bonding curve. Mature-pool swaps are not reconstructed here.`,
  ], "Inspect its current pool and holders. Curve completion earns no attention bonus and cannot establish continued participation.");

  const holdersFresh = evidence?.observedAt && age(evidence.observedAt, now) <= MAX_HOLDER_AGE_MS;
  const depleted = holdersFresh && (evidence.reserveSharePercent !== null && evidence.reserveSharePercent >= 99
    || evidence.holdersComplete && evidence.meaningfulHolders !== null && evidence.meaningfulHolders < 3);
  if (depleted) return result("inactive", "Participation depleted", [
    ...(evidence.reserveSharePercent !== null ? [`${evidence.reserveSharePercent.toFixed(2)}% of supply is held by the identified reserve contracts.`] : []),
    ...(evidence.meaningfulHolders !== null ? [`${evidence.meaningfulHolders} sampled non-contract wallets hold at least 0.01% of supply.`] : []),
    "Past trade counts do not demonstrate a surviving holder base.",
  ], "Retain this in the archive. Reconsider only after new trading and a fresh, broader holder distribution are both verified.");

  if (launch.recentTrades === 0 || age(launch.lastTradeAt, now) > 15 * 60_000) return result("inactive", "No current curve activity", [
    "No sufficiently recent curve trading is verified. Previous trades remain historical evidence.",
  ], "Excluded from current signals. A later return requires new trades and renewed holder evidence; inactivity is not proof the project is permanently dead.");

  const drawdown = launch.peakDrawdownPercent;
  const declining = launch.previousTrades >= 6 && launch.recentTrades < launch.previousTrades * 0.5;
  const selling = launch.netQuoteFlow !== null && launch.netQuoteFlow !== undefined && launch.netQuoteFlow < 0;
  if (drawdown !== null && drawdown !== undefined && drawdown >= 85 || declining || selling && launch.recentSells >= launch.recentBuys * 1.5) return result("stressed", "Activity under stress", [
    ...(drawdown !== null && drawdown !== undefined && drawdown >= 85 ? [`The last indexed execution price is ${drawdown.toFixed(1)}% below its observed window peak, in quote-token units.`] : []),
    ...(declining ? ["Trade activity fell by more than half from the previous pulse."] : []),
    ...(selling ? ["More quote value left the curve than entered during this pulse."] : []),
    ...(launch.creatorSellEvents ? [`${launch.creatorSellEvents} creator sell events were indexed in this window.`] : []),
  ], "Inspect withdrawals, creator trades, and holder retention. This token is excluded from discovery until the measured stress clears.");

  if (!holdersFresh || evidence.meaningfulHolders === null) return result("unverified", "Holder evidence missing", [
    "Trade counts alone do not show retained ownership. A current holder sample is unavailable or older than ten minutes.",
  ], "Verify holders before treating this as relevant. Pools, lockers and other contracts are excluded from wallet breadth; addresses are not people.");

  if (launch.recentTrades < MIN_PULSE_TRADES || launch.recentUniqueTraders < MIN_PULSE_ACTORS
    || launch.previousTrades < 6 || (launch.previousUniqueTraders ?? 0) < 3
    || evidence.meaningfulHolders < MIN_MEANINGFUL_HOLDERS || (evidence.largestWalletSharePercent ?? 100) > 20) return result("unverified", "Insufficient sustained participation", [
    `The two indexed pulses contain ${launch.previousTrades} and ${launch.recentTrades} trades; ${evidence.meaningfulHolders} meaningful non-contract holders were sampled.`,
    "Discovery requires at least 12 recent trades, five recent actors, six prior trades, three prior actors, ten sampled holders each holding at least 0.01%, and no sampled wallet above 20% of supply.",
  ], "Keep this out of the current shortlist. Inspect persistence and retained participation before promoting it.");

  const breadthGrowing = launch.recentUniqueTraders > (launch.previousUniqueTraders ?? 0) * 1.25;
  const growing = launch.recentTrades >= launch.previousTrades * 1.6 && breadthGrowing && !selling;
  const signal = growing ? "surging" : breadthGrowing ? "broadening" : "steady";
  // Bounded components; lifetime counts, graduation and zero-baseline jumps earn no points.
  const score = Math.round(25 * Math.min(1, launch.recentUniqueTraders / 40)
    + 25 * Math.min(1, (launch.previousUniqueTraders ?? 0) / 30)
    + 30 * Math.min(1, evidence.meaningfulHolders / 100)
    + 20 * Math.min(1, Math.min(launch.recentTrades, launch.previousTrades) / 150));
  return result(signal, growing ? "Participation expanding" : breadthGrowing ? "Participation broadening" : "Sustained curve participation", [
    `${launch.recentUniqueTraders} recent actors versus ${launch.previousUniqueTraders} previously; ${evidence.meaningfulHolders} meaningful wallets in the holder sample.`,
    "This is measured market participation. Organic demand, cultural coherence and social resonance are not established by these counts.",
  ], growing ? "Compare the new actors with retained holders next window. Reassess if quote outflow dominates or holder breadth contracts." : "Compare participation with neighboring tokens in this habitat. Check whether holders persist across the next observation.", score);
}

export function applyResearchPolicy(state: PonsStateResponse, now = Date.now()): PonsStateResponse {
  const fresh = currentPonsEvidence(state, now);
  const launches = state.launches.map((launch) => {
    const research = assessLaunch(launch, fresh, now);
    return { ...launch, research, signal: research.signal, attentionScore: research.score ?? 0,
      signalNote: research.reasons[0], confidence: research.eligible ? "medium" as const : "early" as const };
  }).sort((a, b) => Number(b.research.eligible) - Number(a.research.eligible) || b.attentionScore - a.attentionScore || b.blockNumber - a.blockNumber);
  const cohorts = state.cohorts.map((cohort) => ({ ...cohort,
    signal: fresh ? cohort.signal : "historical" as const,
    signalNote: fresh ? cohort.signalNote : "Historical curve counts; current habitat direction is unverified.",
    attentionScore: 0,
  }));
  return { ...state, launches, cohorts, flagship: { ...state.flagship, cohort: cohorts.find((c) => c.symbol === state.flagship.pair) ?? null },
    mode: fresh ? "live" : state.mode === "live" ? "degraded" : state.mode,
    pulse: { ...state.pulse, status: fresh ? "verified" : "delayed", leader: fresh ? state.pulse.leader && launches.some((l) => l.tokenAddress === state.pulse.leader?.tokenAddress && l.research.eligible) ? state.pulse.leader : null : null },
    methodology: { ...state.methodology, scoreVersion: RESEARCH_VERSION, caveats: [
      "Historical trade counts are not present attention. Current rankings require fresh, reconciled evidence.",
      "The participation score is a provisional bounded research filter, not a probability, quality rating or cultural-vitality oracle.",
      "Ownership evidence samples indexed actor balances at one block. It is not the complete holder list; addresses are not people.",
      "Graduated V2 tokens remain unverified until mature-pool swaps are reconstructed. Curve completion earns no score bonus.",
      "X coverage is unavailable unless an authorized data source is configured. No social signal is inferred from missing data.",
    ] },
  };
}

export function evidenceIsFresh(evidence: PonsTokenEvidence, now = Date.now()) {
  return age(evidence.observedAt, now) <= MAX_HOLDER_AGE_MS;
}
