import type { PonsLaunchView } from "./model";

// Browsing evidence is independent of eligibility for a current recommendation.
export function launchesForPair(launches: PonsLaunchView[], pair: string) {
  return launches.filter((launch) => pair === "ALL" || launch.pairSymbol === pair);
}

export function pairSelection(launches: PonsLaunchView[], pair: string) {
  const records = launchesForPair(launches, pair);
  const current = records.find((launch) => launch.research?.eligible);
  return { address: (current ?? records[0])?.tokenAddress ?? null, filter: current ? "active" as const : "all" as const };
}

export function selectedLaunch(launches: PonsLaunchView[], address: string | null) {
  // An explicitly requested archive record must never silently become another token.
  return address ? launches.find((launch) => launch.tokenAddress.toLowerCase() === address.toLowerCase()) ?? null : null;
}
