import { acquireAuxJob, releaseAuxJob } from "@/db/pons-research";
import { loadFactoryFeed, storeFactoryFeed } from "@/db/pons-factory";
import { persistPonsLogs } from "@/db/pons-ledger";
import { getPonsBlock, getPonsBlocks, getPonsFactoryLogs, getPonsHead } from "./pons-rpc";
import { decodeFactoryLog, eventId, hexInt } from "@/lib/pons/decode";
import { PONS_FINALITY_BLOCKS, PONS_PAIR_BY_ADDRESS, PONS_V2_DEPLOYMENT_FLOOR } from "@/lib/pons/constants";
import { FACTORY_COLLECT_INTERVAL_MS, factoryRange, mergeFactoryEvents } from "@/lib/pons/factory-feed";
import type { PonsFactoryFeed, PonsTapeEvent } from "@/lib/pons/model";

export async function runFactoryCollection() {
  if (!await acquireAuxJob("factory-live", FACTORY_COLLECT_INTERVAL_MS)) return { status: "skipped" };
  let previous: PonsFactoryFeed | null = null;
  const attemptedAt = new Date().toISOString();
  const deadline = Date.now() + 20_000;
  try {
    previous = await loadFactoryFeed();
    // Share the minimum cadence across visitors and back off after provider failures.
    const minimumGap = Math.min(60_000, FACTORY_COLLECT_INTERVAL_MS * 2 ** Math.min(3, previous?.consecutiveFailures ?? 0));
    if (previous?.lastAttemptAt && Date.now() - Date.parse(previous.lastAttemptAt) < minimumGap) return { status: "skipped" };
    const head = await getPonsHead(deadline);
    const safeHead = Math.max(PONS_V2_DEPLOYMENT_FLOOR, head.number - PONS_FINALITY_BLOCKS);
    const cursor = previous?.indexedBlock || null;
    const range = factoryRange(cursor, safeHead, PONS_V2_DEPLOYMENT_FLOOR);
    const reset = cursor === null || cursor > safeHead || range.fromBlock > cursor + 1;
    const logs = range.toBlock >= range.fromBlock ? await getPonsFactoryLogs(range.fromBlock, range.toBlock, deadline) : [];
    const endpoint = await getPonsBlock(range.toBlock, false, deadline);
    // Use actual block times. Never label an old event with collection time.
    const times = new Map<number, number>([[range.toBlock, endpoint.timestamp]]);
    const missing = new Set<number>();
    for (const log of logs) {
      const block = hexInt(log.blockNumber);
      if (log.blockTimestamp) times.set(block, hexInt(log.blockTimestamp));
      else if (!times.has(block)) {
        missing.add(block);
      }
    }
    for (const block of await getPonsBlocks([...missing], deadline)) times.set(block.number, block.timestamp);
    const confirmed = await getPonsBlock(range.toBlock, false, deadline);
    if (confirmed.hash !== endpoint.hash || logs.some(log => hexInt(log.blockNumber) < range.fromBlock || hexInt(log.blockNumber) > range.toBlock)) throw new Error("factory_window_changed");
    const events: PonsTapeEvent[] = logs.flatMap((log) => {
      const decoded = decodeFactoryLog(log);
      if (!decoded) return [];
      return [{ id: eventId(log), eventType: decoded.type, tokenAddress: decoded.tokenAddress,
        tokenSymbol: "—", pairSymbol: decoded.type === "launch" ? PONS_PAIR_BY_ADDRESS.get(decoded.pairTokenAddress)?.symbol ?? "—" : "—",
        blockNumber: hexInt(log.blockNumber), observedAt: new Date(times.get(hexInt(log.blockNumber))! * 1000).toISOString(), txHash: log.transactionHash,
        detail: decoded.type === "launch" ? "Factory confirmed a new launch" : decoded.type === "graduation" ? "Factory confirmed graduation" : decoded.type === "sweep" ? "Factory confirmed curve completion" : "Factory confirmed a permanent lock" }];
    });
    // Store canonical identities for name resolution, but leave the trade commit untouched.
    await persistPonsLogs({ factoryLogs: logs.map((log) => ({ ...log, blockTimestamp: `0x${times.get(hexInt(log.blockNumber))!.toString(16)}` })), curveLogs: [], fallbackTimestamp: endpoint.timestamp });
    const feed: PonsFactoryFeed = { fromBlock: reset ? range.fromBlock : previous?.fromBlock || range.fromBlock, indexedBlock: range.toBlock,
      indexedHash: endpoint.hash, headBlock: head.number, observedAt: new Date(head.timestamp * 1000).toISOString(), lastAttemptAt: attemptedAt,
      lastError: null, consecutiveFailures: 0, events: mergeFactoryEvents(reset ? [] : previous?.events ?? [], events, range.fromBlock) };
    await storeFactoryFeed(feed);
    return { status: "recorded", indexedBlock: feed.indexedBlock, headBlock: head.number, events: events.length };
  } catch (error) {
    const message = error instanceof Error ? error.message.slice(0, 160) : "factory_collection_failed";
    await storeFactoryFeed({ ...(previous ?? { fromBlock: 0, indexedBlock: 0, indexedHash: "", headBlock: 0, observedAt: "", events: [] }),
      lastAttemptAt: attemptedAt, lastError: message, consecutiveFailures: (previous?.consecutiveFailures ?? 0) + 1 });
    throw error;
  } finally { await releaseAuxJob("factory-live"); }
}
