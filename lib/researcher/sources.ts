import { robinhoodExplorer } from "@/lib/robinhood-explorer";
import type { TokenSearchResult } from "@/lib/tokens/model";
import type { ResearchDossier } from "@/lib/premium/research";
import { recentCurveIsFresh, type RecentCurveCheck } from "@/lib/premium/recent-curve";
import type { ResearchSource } from "./model";

export function recentTimestamp(value: string | null | undefined, now = Date.now(), maxAge = 120_000) {
  const age = value ? now - Date.parse(value) : NaN;
  return Number.isFinite(age) && age >= -30_000 && age <= maxAge;
}
export function unavailableSource(id: string, token: string, limitation: string, now = Date.now()): ResearchSource {
  return { id, label: { market: "Token identity & market", index: "Indexed curve history", curve: "Recent curve check", holders: "Holder snapshot" }[id] ?? id,
    url: robinhoodExplorer.address(token), fetchedAt: new Date(now).toISOString(), evidenceAt: null,
    freshness: "unavailable", facts: [], limitations: [limitation], metrics: {} };
}
export function marketSource(token: string, item: TokenSearchResult | null, now = Date.now()): ResearchSource {
  if (!item || item.tokenAddress !== token) return unavailableSource("market", token, "Token identity or market observations could not be resolved. This is not evidence of an inactive token.", now);
  const facts = [`Contract: ${token}.`, `Reported identity: ${item.name ?? "name unresolved"}${item.symbol ? ` (${item.symbol})` : ""}.`];
  if (item.marketCapUsd != null) facts.push(`PONS-reported market cap: $${item.marketCapUsd.toLocaleString("en-US")}.`);
  if (item.volume24hUsd != null) facts.push(`PONS-reported trailing 24h volume: $${item.volume24hUsd.toLocaleString("en-US")}.`);
  if (item.latestBuyAt) facts.push(`Latest buy reported by PONS: ${item.latestBuyAt}. This is not the latest trade timestamp.`);
  if (item.graduated !== undefined) facts.push(`PONS graduation flag: ${item.graduated ? "graduated" : "not graduated"}.`);
  return { id: "market", label: "Token identity & market", url: item.source === "pons" ? `https://www.ponsfamily.com/launchpad/${token}` : robinhoodExplorer.address(token),
    fetchedAt: new Date(now).toISOString(), evidenceAt: item.sourceFetchedAt ?? null,
    freshness: !item.sourceStale && recentTimestamp(item.sourceFetchedAt, now) ? "recent" : "historical", facts,
    limitations: ["Identity is not an endorsement. Market figures are source-reported snapshots, not a reconstructed trade ledger.", ...(item.sourceFetchedAt ? [] : ["The source observation time is unavailable; current market conditions cannot be established."])],
    metrics: { marketCapUsd: item.marketCapUsd ?? null, volume24hUsd: item.volume24hUsd ?? null, graduated: item.graduated === undefined ? null : String(item.graduated) } };
}
export function indexedSource(token: string, dossier: ResearchDossier | null, now = Date.now()): ResearchSource {
  if (!dossier) return unavailableSource("index", token, "This token has no supported PONS V2 dossier in the current index. Broader market or other-chain coverage is not implied.", now);
  const coverage = dossier.coverage, window = dossier.windows[0];
  return { id: "index", label: "Indexed curve history", url: robinhoodExplorer.address(dossier.token.curveAddress),
    fetchedAt: new Date(now).toISOString(), evidenceAt: window?.lastTradeAt ?? null,
    freshness: coverage.current && recentTimestamp(coverage.lastCollectedAt, now) ? "recent" : "historical",
    facts: [
      `Index through block ${coverage.throughBlock}; ${coverage.lagBlocks} blocks behind the last observed head. Collection time: ${coverage.lastCollectedAt ?? "unavailable"}.`,
      ...dossier.windows.map(w => `Blocks ${w.fromBlock}–${w.toBlock}: ${w.trades} ${w.sampled ? "sampled" : "indexed"} trades, ${w.actors} wallet addresses, ${w.buys} buys and ${w.sells} sells. Last indexed trade in this window: ${w.lastTradeAt ?? "none returned"}.`),
    ], limitations: [coverage.limitation, "Wallet addresses do not establish distinct people. Counts across windows do not prove retention or organic demand.", ...(!coverage.current ? ["Historical evidence cannot establish current participation or momentum."] : [])],
    metrics: { throughBlock: coverage.throughBlock, windowBlocks: dossier.selection.windowBlocks, trades: window?.sampled ? null : window?.trades ?? null, actors: window?.sampled ? null : window?.actors ?? null } };
}
export function curveSource(token: string, check: RecentCurveCheck | null, graduated: boolean, now = Date.now()): ResearchSource {
  if (graduated) return unavailableSource("curve", token, "This token is marked graduated. A bonding-curve sample would omit subsequent pool trading and is not used to assess current activity.", now);
  if (!check || check.tokenAddress !== token) return unavailableSource("curve", token, "A recent verified curve sample could not be collected. No zero-activity claim is made.", now);
  return { id: "curve", label: "Recent curve check", url: robinhoodExplorer.address(check.curveAddress),
    fetchedAt: new Date(now).toISOString(), evidenceAt: check.throughTime,
    freshness: recentCurveIsFresh(check, now) && recentTimestamp(check.throughTime, now, 300_000) ? "recent" : "historical",
    facts: [`Curve blocks ${check.fromBlock}–${check.throughBlock}, from ${check.fromTime} through ${check.throughTime}: ${check.trades} trades, ${check.buys} buys, ${check.sells} sells, ${check.actors} wallet addresses.`],
    limitations: ["This bounded sample covers the discovered bonding curve only. It excludes pool swaps, offchain attention and other chains.", "One sample does not demonstrate participation growth, retention, or distinct people."],
    metrics: { throughBlock: check.throughBlock, windowBlocks: check.throughBlock - check.fromBlock + 1, trades: check.trades, actors: check.actors } };
}
export function holderSource(token: string, dossier: ResearchDossier | null, now = Date.now()): ResearchSource {
  const evidence = dossier?.holderEvidence;
  if (!evidence?.observedAt) return unavailableSource("holders", token, "No dated holder distribution was returned. Trade wallet counts cannot substitute for token holders.", now);
  return { id: "holders", label: "Holder snapshot", url: `${robinhoodExplorer.token(token)}#balances`, fetchedAt: new Date(now).toISOString(), evidenceAt: evidence.observedAt,
    freshness: recentTimestamp(evidence.observedAt, now, 300_000) ? "recent" : "historical",
    facts: [`Reported holder count: ${evidence.holderCount ?? "unavailable"}. Sample: ${evidence.holderSampleSize} addresses.`, `Largest sampled wallet share: ${evidence.largestWalletSharePercent == null ? "unavailable" : `${evidence.largestWalletSharePercent}%`}. Reserve share: ${evidence.reserveSharePercent == null ? "unavailable" : `${evidence.reserveSharePercent}%`}.`],
    limitations: [evidence.holdersComplete ? "Complete distribution returned for the recorded snapshot, not continuous holder tracking." : "Partial holder sample; concentration and distribution claims are limited to returned records.", "A wallet may be a pool, contract or one of several addresses controlled by the same person. Holder retention is not established."],
    metrics: { holderCount: evidence.holderCount ?? null } };
}

/** Existing collectors have their own limits. A timed-out read cannot mutate a report later. */
export async function boundedRead<T>(work: Promise<T>, deadline: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try { return await Promise.race([work, new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error("source_timeout")), Math.max(1, deadline - Date.now())); })]); }
  finally { clearTimeout(timer); }
}
