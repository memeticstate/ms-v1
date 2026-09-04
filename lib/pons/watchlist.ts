import type { PonsActivitySignal, PonsLaunchView } from "@/lib/pons/model";

export const WATCHLIST_STORAGE_KEY = "memetic-state:pons-watchlist:v1";

export type WatchRules = {
  signalChange: boolean;
  lifecycleChange: boolean;
  activityThreshold: number | null;
  momentumThreshold: number | null;
};

export type WatchSnapshot = {
  signal: PonsActivitySignal;
  phase: PonsLaunchView["phase"];
  recentTrades: number;
  momentumPercent: number | null;
  attentionScore: number;
};

export type WatchAlertKind = "signal" | "lifecycle" | "activity" | "momentum";

export type WatchAlert = {
  id: string;
  kind: WatchAlertKind;
  title: string;
  detail: string;
  observedAt: string;
  read: boolean;
};

export type WatchEntry = {
  tokenAddress: string;
  name: string;
  symbol: string;
  pairSymbol: string;
  pairColor: string;
  savedAt: string;
  updatedAt: string;
  rules: WatchRules;
  lastSeen: WatchSnapshot;
  alerts: WatchAlert[];
};

export const defaultWatchRules: WatchRules = {
  signalChange: true,
  lifecycleChange: true,
  activityThreshold: 25,
  momentumThreshold: 50,
};

function snapshot(launch: PonsLaunchView): WatchSnapshot {
  return {
    signal: launch.signal,
    phase: launch.phase,
    recentTrades: launch.recentTrades,
    momentumPercent: launch.momentumPercent,
    attentionScore: launch.attentionScore,
  };
}

export function createWatchEntry(launch: PonsLaunchView, savedAt = new Date().toISOString()): WatchEntry {
  return {
    tokenAddress: launch.tokenAddress.toLowerCase(),
    name: launch.name,
    symbol: launch.symbol,
    pairSymbol: launch.pairSymbol,
    pairColor: launch.pairColor,
    savedAt,
    updatedAt: savedAt,
    rules: { ...defaultWatchRules },
    lastSeen: snapshot(launch),
    alerts: [],
  };
}

function crossed(previous: number | null, current: number | null, threshold: number | null) {
  return threshold !== null
    && current !== null
    && current >= threshold
    && (previous === null || previous < threshold);
}

function alert(entry: WatchEntry, kind: WatchAlertKind, title: string, detail: string, observedAt: string): WatchAlert {
  return {
    id: `${entry.tokenAddress}:${kind}:${observedAt}`,
    kind,
    title,
    detail,
    observedAt,
    read: false,
  };
}

export function reconcileWatchEntry(entry: WatchEntry, launch: PonsLaunchView, observedAt: string): { entry: WatchEntry; newAlerts: number } {
  const next = snapshot(launch);
  const alerts: WatchAlert[] = [];

  if (entry.rules.signalChange && entry.lastSeen.signal !== next.signal) {
    alerts.push(alert(entry, "signal", `${launch.symbol} changed signal`, `${entry.lastSeen.signal} → ${next.signal}`, observedAt));
  }
  if (entry.rules.lifecycleChange && entry.lastSeen.phase !== next.phase) {
    alerts.push(alert(entry, "lifecycle", `${launch.symbol} changed lifecycle`, `${entry.lastSeen.phase} → ${next.phase}`, observedAt));
  }
  if (crossed(entry.lastSeen.recentTrades, next.recentTrades, entry.rules.activityThreshold)) {
    alerts.push(alert(entry, "activity", `${launch.symbol} crossed its activity rule`, `${next.recentTrades} recent trades · threshold ${entry.rules.activityThreshold}`, observedAt));
  }
  if (crossed(entry.lastSeen.momentumPercent, next.momentumPercent, entry.rules.momentumThreshold)) {
    alerts.push(alert(entry, "momentum", `${launch.symbol} crossed its momentum rule`, `${next.momentumPercent}% momentum · threshold ${entry.rules.momentumThreshold}%`, observedAt));
  }

  return {
    entry: {
      ...entry,
      name: launch.name,
      symbol: launch.symbol,
      pairSymbol: launch.pairSymbol,
      pairColor: launch.pairColor,
      updatedAt: observedAt,
      lastSeen: next,
      alerts: [...alerts, ...entry.alerts].slice(0, 20),
    },
    newAlerts: alerts.length,
  };
}

export function reconcileWatchlist(entries: WatchEntry[], launches: PonsLaunchView[], observedAt: string) {
  const byAddress = new Map(launches.map((launch) => [launch.tokenAddress.toLowerCase(), launch]));
  let newAlerts = 0;
  const nextEntries = entries.map((entry) => {
    const launch = byAddress.get(entry.tokenAddress.toLowerCase());
    if (!launch) return entry;
    const result = reconcileWatchEntry(entry, launch, observedAt);
    newAlerts += result.newAlerts;
    return result.entry;
  });
  return { entries: nextEntries, newAlerts };
}

export function parseWatchlist(raw: string | null): WatchEntry[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((entry): entry is WatchEntry => Boolean(
      entry
      && typeof entry === "object"
      && "tokenAddress" in entry
      && typeof entry.tokenAddress === "string"
      && "rules" in entry
      && "lastSeen" in entry
      && "alerts" in entry
      && Array.isArray(entry.alerts),
    ));
  } catch {
    return [];
  }
}
