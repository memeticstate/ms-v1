import type { PonsActivitySignal, PonsLaunchView, PonsStateResponse } from "./model";
import { assessLaunch, currentPonsEvidence } from "./research";

export type LandingSignal = {
  launch: PonsLaunchView;
  signal: PonsActivitySignal;
  label: string;
  tone: "positive" | "caution" | "negative" | "neutral";
  summary: string;
  explanation: string;
  support: string;
  uncertainty: string;
  eligible: boolean;
};

const language: Record<PonsActivitySignal, Pick<LandingSignal, "label" | "tone" | "summary" | "explanation">> = {
  surging: {
    label: "Growing", tone: "positive", summary: "More trading. More participating wallets.",
    explanation: "Trading and wallet participation have both increased across the two measured periods.",
  },
  broadening: {
    label: "Broadening", tone: "positive", summary: "More wallets are taking part.",
    explanation: "More wallet addresses are trading than in the previous measured period.",
  },
  steady: {
    label: "Holding steady", tone: "positive", summary: "Participation is continuing.",
    explanation: "The token meets the existing checks for trading and retained ownership across two measured periods.",
  },
  forming: {
    label: "Early activity", tone: "caution", summary: "Activity has started. Too early to tell.",
    explanation: "The first observed trades do not yet establish sustained participation.",
  },
  cooling: {
    label: "Slowing", tone: "negative", summary: "Trading has slowed.",
    explanation: "Fewer trades were recorded than in the previous measured period.",
  },
  stressed: {
    label: "Under pressure", tone: "negative", summary: "Activity has weakened or money is leaving.",
    explanation: "The evidence has triggered a stress check. This token is excluded from the current shortlist.",
  },
  quiet: {
    label: "Quiet", tone: "neutral", summary: "No recent curve trades were observed.",
    explanation: "There is not enough recent trading evidence to establish continued activity.",
  },
  inactive: {
    label: "Inactive", tone: "neutral", summary: "Current participation is not established.",
    explanation: "The evidence does not support including this token in the current shortlist.",
  },
  historical: {
    label: "Past activity", tone: "neutral", summary: "An earlier observation, not a current signal.",
    explanation: "These trades belong to an older indexed period. They cannot tell us what is happening now.",
  },
  unverified: {
    label: "Needs checking", tone: "caution", summary: "Not enough verified evidence yet.",
    explanation: "Trading alone is not enough. This token has not passed all the existing participation checks.",
  },
};

export function landingSignal(launch: PonsLaunchView, state: PonsStateResponse, now = Date.now()): LandingSignal {
  // Reuse the engine's exact policy. This layer only translates its result;
  // in particular, an old successful response must lose its positive badge.
  const reading = assessLaunch(launch, currentPonsEvidence(state, now), now);
  const copy = language[reading.signal];
  const ownershipDepleted = reading.signal === "inactive" && reading.label === "Participation depleted";
  const support = reading.eligible
    ? `${launch.recentUniqueTraders} trading wallets in the latest period; ${launch.previousUniqueTraders ?? 0} previously. ${launch.currentEvidence?.meaningfulHolders ?? 0} wallets retain a meaningful balance in the ownership sample.`
    : reading.signal === "historical"
      ? `${launch.recentTrades} trades across ${launch.recentUniqueTraders} wallet addresses in the older indexed period.`
      : reading.reasons[0] ?? "The required evidence is not available yet.";
  const uncertainty = reading.signal === "historical"
    ? "Current activity is unverified while the trading index catches up. Open the app to inspect coverage."
    : reading.eligible
      ? "A short observation, not a prediction. Wallets are not necessarily different people, and the holder sample is incomplete."
      : reading.signal === "stressed"
        ? "Stress is an observation, not a prediction of failure or recovery. Check the full evidence before drawing a conclusion."
        : ownershipDepleted
          ? "Ownership and trades have separate timestamps. Past trading does not prove that holders stayed."
          : launch.phase !== "bonding"
            ? "This token has left its launch curve. These curve records do not establish current trading in its new pool."
            : "Missing evidence is not proof of failure. Holder retention and continuing activity still need verification.";
  return {
    launch, signal: reading.signal, ...copy, support, uncertainty, eligible: reading.eligible,
    ...(ownershipDepleted ? {
      summary: "Retained participation is depleted.",
      explanation: "The current ownership sample indicates depleted participation. Historical trading does not outweigh that observation.",
    } : {}),
  };
}

export function landingSignals(state: PonsStateResponse, tab: "changes" | "launches", query: string, now = Date.now()) {
  const needle = query.trim().toLowerCase().replace(/^\$/, "");
  const records = state.launches.filter((launch) =>
    [launch.symbol, launch.name, launch.tokenAddress].some((value) => value.toLowerCase().includes(needle)),
  ).map((launch) => landingSignal(launch, state, now));
  const priority = (item: LandingSignal) => item.eligible ? 0 : item.signal === "stressed" ? 1 : item.signal === "unverified" ? 2 : 3;
  records.sort((a, b) => tab === "launches"
    ? b.launch.blockNumber - a.launch.blockNumber
    : priority(a) - priority(b) || b.launch.attentionScore - a.launch.attentionScore || b.launch.blockNumber - a.launch.blockNumber);
  // A landing page is a small preview, never a second ranking engine.
  return records.slice(0, 5);
}

export function isTokenAddress(value: string) {
  return /^0x[a-fA-F0-9]{40}$/.test(value.trim());
}

export function tokenAppHref(address: string) {
  if (!isTokenAddress(address)) return "/app";
  return `/app?view=signals&token=${encodeURIComponent(address.toLowerCase())}&inspect=1`;
}

export function legacyAppHref(params: Record<string, string | string[] | undefined>) {
  if (!["view", "pair", "window", "token"].some((key) => params[key] !== undefined)) return null;
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    for (const part of Array.isArray(value) ? value : value === undefined ? [] : [value]) query.append(key, part);
  }
  return `/app?${query.toString()}`;
}
