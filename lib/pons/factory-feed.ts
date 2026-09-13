import type { PonsFactoryFeed, PonsTapeEvent } from "./model";

export const FACTORY_READ_INTERVAL_MS = 5_000;
export const FACTORY_COLLECT_INTERVAL_MS = 12_000;

// Compare observation versions, not heights: a valid reorg can reduce the height.
export function latestFactoryFeed(current: PonsFactoryFeed | null, incoming: PonsFactoryFeed | null | undefined) {
  if (!incoming) return current;
  if (!current) return incoming;
  return Date.parse(incoming.lastAttemptAt) >= Date.parse(current.lastAttemptAt) ? incoming : current;
}
export function arrivingFactoryEvents(previous: PonsFactoryFeed | null, incoming: PonsFactoryFeed) {
  if (!previous) return [];
  const known = new Set(previous.events.map((event) => event.id));
  return incoming.events.filter((event) => !known.has(event.id)).map((event) => event.id);
}

export function factoryRange(cursor: number | null, safeHead: number, floor: number) {
  // This is a recent-event window, not a second archive. Rebase after downtime
  // and rescan a small overlap for reorgs; the trade/archive cursor is untouched.
  const fromBlock = Math.max(floor, safeHead - 1999,
    cursor === null ? floor : Math.min(cursor, safeHead) - 255);
  return { fromBlock, toBlock: safeHead };
}

export function mergeFactoryEvents(previous: PonsTapeEvent[], incoming: PonsTapeEvent[], rescanFrom: number) {
  const byId = new Map(previous.filter((event) => event.blockNumber < rescanFrom).map((event) => [event.id, event]));
  for (const event of incoming) byId.set(event.id, event);
  return [...byId.values()].sort((a, b) => b.blockNumber - a.blockNumber || b.id.localeCompare(a.id)).slice(0, 150);
}

export function factoryFeedFresh(feed: PonsFactoryFeed | null | undefined, now = Date.now()) {
  return Boolean(feed && feed.indexedBlock > 0 && feed.consecutiveFailures === 0 && !feed.lastError
    && feed.headBlock - feed.indexedBlock <= 3000 && now - Date.parse(feed.observedAt) <= 120_000);
}
