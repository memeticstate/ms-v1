import type { PonsStateResponse } from "@/lib/pons/model";
import { landingSignals } from "@/lib/pons/landing";
import type { TokenDiscoveryResponse, TokenSearchResult } from "./model";

export type RadarReading = {
  token: TokenSearchResult;
  label: string;
  tone: "positive" | "caution" | "negative" | "neutral";
  summary: string;
  explanation: string;
  support: string;
  uncertainty: string;
  evidenceLabel: string;
  evidenceAt: string | null;
  kind: "research" | "market" | "launch";
};
export function usd(value: number | null | undefined) {
  return value === null || value === undefined || !Number.isFinite(value) ? "Unavailable"
    : new Intl.NumberFormat("en", { style: "currency", currency: "USD", notation: "compact", maximumFractionDigits: 1 }).format(value);
}
export function within(value: string | null | undefined, age: number, now: number) {
  const time = Date.parse(value ?? "");
  return Number.isFinite(time) && time <= now + 30_000 && now - time <= age;
}
export function usableDiscovery(token: TokenSearchResult, now: number) {
  return !token.sourceStale && within(token.sourceFetchedAt, 120_000, now);
}
function marketReading(token: TokenSearchResult, kind: "market" | "launch"): RadarReading {
  const hasCap = token.marketCapUsd !== null && token.marketCapUsd !== undefined;
  return { token, kind, tone: "neutral", label: kind === "market" ? "Recent trading" : "New launch",
    summary: kind === "market" ? `Recent buying.${hasCap ? ` ${usd(token.marketCapUsd)} market cap.` : ""}`
      : `New${token.pairSymbol ? ` ${token.pairSymbol}-paired` : ""} token.${hasCap ? ` ${usd(token.marketCapUsd)} market cap.` : ""}`,
    explanation: kind === "market" ? "A graduated PONS market with a recently reported buy. Check who is participating and whether activity is continuing."
      : "A newly listed token. Its launch is a starting point for investigation; sustained participation is not established yet.",
    support: `${kind === "market" ? "PONS reports a recent buy" : "PONS reports this launch"}${token.pairSymbol ? ` · paired with ${token.pairSymbol}` : ""}${token.graduated ? " · graduated" : ""}.${token.volume24hUsd != null ? ` Reported 24h volume: ${usd(token.volume24hUsd)}.` : ""}`,
    uncertainty: "Market data is reported by PONS. A recent buy and market cap do not establish organic demand, retained holders, or a Memetic research signal.",
    evidenceLabel: kind === "market" ? "Latest buy reported by PONS" : "Launch reported by PONS",
    evidenceAt: kind === "market" ? token.latestBuyAt ?? null : token.launchedAt ?? null,
  };
}

export function radarReadings(state: PonsStateResponse | null, discovery: TokenDiscoveryResponse | null, tab: "changes" | "launches", now: number): RadarReading[] {
  const research: RadarReading[] = state && tab === "changes" ? landingSignals(state, "changes", "", now)
    .filter(item => item.eligible || item.signal === "stressed")
    .map(item => ({ ...item, token: { ...item.launch, source: "index", indexed: true }, kind: "research", evidenceLabel: "Last indexed trade", evidenceAt: item.launch.lastTradeAt ?? null })) : [];
  const markets = (discovery?.markets ?? []).filter(token => usableDiscovery(token, now) && within(token.latestBuyAt, 60 * 60_000, now)
    && token.graduated && (token.marketCapUsd ?? 0) > 0)
    .sort((a, b) => (b.marketCapUsd ?? 0) - (a.marketCapUsd ?? 0));
  const launches = (discovery?.launches ?? []).filter(token => usableDiscovery(token, now) && within(token.launchedAt, 24 * 60 * 60_000, now))
    .sort((a, b) => Date.parse(b.launchedAt ?? "") - Date.parse(a.launchedAt ?? ""));
  const rows = tab === "launches" ? launches.map(token => marketReading(token, "launch"))
    : [...research, ...markets.map(token => marketReading(token, "market"))];
  // Deduplicate by contract, never by ticker. Stale historical rows do not fill
  // today's radar, and popularity is not substituted for research eligibility.
  const unique = new Map<string, RadarReading>();
  for (const row of rows) if (!unique.has(row.token.tokenAddress)) unique.set(row.token.tokenAddress, row);
  return [...unique.values()].slice(0, 5);
}
