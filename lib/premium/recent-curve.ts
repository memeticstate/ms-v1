import { decodeCurveTrade, eventId, hexInt, validRpcLog, type RpcLog } from "@/lib/pons/decode";

export const RECENT_CURVE_BLOCKS = 2_000;
export const RECENT_CURVE_MAX_LOGS = 1_000;
export const RECENT_CURVE_CACHE_MS = 60_000;
export const RECENT_CURVE_FRESH_MS = 120_000;

export type RecentCurveTrade = { id: string; side: "buy" | "sell"; actor: string; transaction: string; blockNumber: number; quoteAmountRaw: string };
export type RecentCurveCheck = {
  tokenAddress: string; curveAddress: string; provider: string; checkedAt: string;
  headBlock: number; headObservedAt: string; fromBlock: number; throughBlock: number;
  fromTime: string; throughTime: string; throughHash: string;
  trades: number; buys: number; sells: number; actors: number; recentTrades: RecentCurveTrade[];
};
export type RecentCurveResult = { check: RecentCurveCheck | null; lastError: string | null; retryAt: string | null };

export function recentCurveIsFresh(check: RecentCurveCheck | null, now = Date.now()) {
  if (!check) return false;
  const age = now - Date.parse(check.headObservedAt);
  const checkedAge = now - Date.parse(check.checkedAt);
  return Number.isFinite(age) && age >= -30_000 && age <= RECENT_CURVE_FRESH_MS
    && Number.isFinite(checkedAge) && checkedAge >= -30_000 && checkedAge <= RECENT_CURVE_FRESH_MS;
}

export function summarizeRecentCurveLogs(logs: RpcLog[], curve: string, from: number, through: number, throughHash: string) {
  if (logs.length >= RECENT_CURVE_MAX_LOGS) throw new Error("recent_curve_window_too_busy");
  const events = new Map<string, RecentCurveTrade>();
  const seen = new Map<string, string>();
  const blockHashes = new Map<number, string>([[through, throughHash.toLowerCase()]]);
  for (const log of logs) {
    if (!validRpcLog(log) || log.removed || log.address.toLowerCase() !== curve.toLowerCase()) throw new Error("recent_curve_invalid_log");
    const block = hexInt(log.blockNumber), index = hexInt(log.logIndex);
    if (!Number.isSafeInteger(block) || !Number.isSafeInteger(index) || block < from || block > through) throw new Error("recent_curve_log_outside_window");
    const hash = log.blockHash.toLowerCase();
    if (blockHashes.has(block) && blockHashes.get(block) !== hash) throw new Error("recent_curve_reorg");
    blockHashes.set(block, hash);
    const decoded = decodeCurveTrade(log);
    if (!decoded) throw new Error("recent_curve_invalid_topic");
    const id = eventId(log);
    const fingerprint = JSON.stringify([block, hash, log.data.toLowerCase(), log.topics.map(t => t.toLowerCase())]);
    if (seen.has(id) && seen.get(id) !== fingerprint) throw new Error("recent_curve_conflicting_log");
    seen.set(id, fingerprint);
    events.set(id, { id, side: decoded.side, actor: decoded.actorAddress, transaction: log.transactionHash.toLowerCase(), blockNumber: block, quoteAmountRaw: decoded.quoteAmountRaw });
  }
  const trades = [...events.values()].sort((a, b) => b.blockNumber - a.blockNumber || Number(b.id.split(":")[1]) - Number(a.id.split(":")[1]));
  return { trades: trades.length, buys: trades.filter(t => t.side === "buy").length, sells: trades.filter(t => t.side === "sell").length,
    actors: new Set(trades.map(t => t.actor)).size, recentTrades: trades.slice(0, 20) };
}
