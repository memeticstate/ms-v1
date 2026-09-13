import assert from "node:assert/strict";
import test, { after } from "node:test";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";

const root = fileURLToPath(new URL("..", import.meta.url));
const vite = await createServer({ appType: "custom", configFile: false, root,
  resolve: { alias: { "@": root } }, server: { middlewareMode: true, hmr: false } });
after(() => vite.close());
const { launchesForPair, pairSelection, selectedLaunch } = await vite.ssrLoadModule("/lib/pons/navigation.ts");
const { factoryRange, mergeFactoryEvents, factoryFeedFresh } = await vite.ssrLoadModule("/lib/pons/factory-feed.ts");

const records = [
  { tokenAddress: "0xaaa", pairSymbol: "NVDA", research: { eligible: false, score: null } },
  { tokenAddress: "0xbbb", pairSymbol: "ETH", research: { eligible: true, score: 20 } },
];

test("historical habitats remain browsable without promoting their tokens", () => {
  assert.deepEqual(launchesForPair(records, "NVDA"), [records[0]]);
  assert.deepEqual(pairSelection(records, "NVDA"), { address: "0xaaa", filter: "all" });
  assert.deepEqual(pairSelection(records, "ETH"), { address: "0xbbb", filter: "active" });
  assert.deepEqual(pairSelection(records, "GLD"), { address: null, filter: "all" });
  assert.equal(records[0].research.eligible, false);
  assert.equal(records[0].research.score, null);
});

test("all inspection sources resolve the requested token independently of a habitat filter", () => {
  assert.equal(selectedLaunch(records, "0xAAA"), records[0]);
  assert.equal(selectedLaunch(records, "0xbbb"), records[1]);
  assert.equal(selectedLaunch(records, "0xccc"), null);
  assert.equal(selectedLaunch(records, null), null);
});

test("recent factory collection reaches the head after downtime and overlaps for reorgs", () => {
  assert.deepEqual(factoryRange(null, 60_000, 25_000), { fromBlock: 58_001, toBlock: 60_000 });
  assert.deepEqual(factoryRange(60_000, 90_000, 25_000), { fromBlock: 88_001, toBlock: 90_000 });
  assert.deepEqual(factoryRange(90_000, 90_000, 25_000), { fromBlock: 89_745, toBlock: 90_000 });
  assert.deepEqual(factoryRange(90_200, 90_000, 25_000), { fromBlock: 89_745, toBlock: 90_000 });
  assert.deepEqual(factoryRange(null, 25_005, 25_000), { fromBlock: 25_000, toBlock: 25_005 });
});

test("factory retries deduplicate evidence and a reorg removes rescanned orphan events", () => {
  const previous = [{ id: "old", blockNumber: 8 }, { id: "orphan", blockNumber: 10 }];
  const incoming = [{ id: "canonical", blockNumber: 10 }];
  const merged = mergeFactoryEvents(previous, incoming, 9);
  assert.deepEqual(merged.map((event) => event.id), ["canonical", "old"]);
  assert.deepEqual(mergeFactoryEvents(merged, incoming, 9), merged);
});

test("factory freshness cannot be inferred from success alone", () => {
  const now = Date.parse("2026-09-08T02:00:00Z");
  const feed = { indexedBlock: 60_000, headBlock: 60_064, observedAt: new Date(now).toISOString(), consecutiveFailures: 0, lastError: null };
  assert.equal(factoryFeedFresh(feed, now), true);
  assert.equal(factoryFeedFresh(feed, now + 121_000), false);
  assert.equal(factoryFeedFresh({ ...feed, headBlock: 80_000 }, now), false);
  assert.equal(factoryFeedFresh({ ...feed, lastError: "http_429", consecutiveFailures: 1 }, now), false);
});
