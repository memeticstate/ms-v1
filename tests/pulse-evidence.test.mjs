import assert from "node:assert/strict";
import test, { after } from "node:test";
import { readFile, readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";
import { createServer } from "vite";

const root = fileURLToPath(new URL("..", import.meta.url));
const vite = await createServer({ appType: "custom", configFile: false, root,
  resolve: { alias: { "@": root } }, server: { middlewareMode: true, hmr: false } });
const sqlite = new DatabaseSync(":memory:");
for (const file of (await readdir(new URL("../drizzle/", import.meta.url))).filter((name) => name.endsWith(".sql")).sort()) {
  sqlite.exec(await readFile(new URL(`../drizzle/${file}`, import.meta.url), "utf8"));
}
after(async () => { sqlite.close(); await vite.close(); });
const { setRuntimeBindings } = await vite.ssrLoadModule("/db/index.ts");
setRuntimeBindings({ DB: { prepare(sql) {
  let values = [];
  return {
    bind(...args) { assert.ok(args.length <= 100, "D1 bind limit"); values = args; return this; },
    async first() { return sqlite.prepare(sql).get(...values) ?? null; },
    async all() { return { results: sqlite.prepare(sql).all(...values) }; },
    async run() { return { meta: { changes: sqlite.prepare(sql).run(...values).changes } }; },
  };
} } });
const { getPulseEvidence } = await vite.ssrLoadModule("/db/pons-pulse.ts");
const { GET } = await vite.ssrLoadModule("/app/api/pons-pulse/route.ts");
const { decorateResearch, acquireAuxJob, releaseAuxJob } = await vite.ssrLoadModule("/db/pons-research.ts");
const { PONS_V2_DEPLOYMENT_FLOOR } = await vite.ssrLoadModule("/lib/pons/constants.ts");
const { latestFactoryFeed, arrivingFactoryEvents, FACTORY_COLLECT_INTERVAL_MS } = await vite.ssrLoadModule("/lib/pons/factory-feed.ts");

const from = PONS_V2_DEPLOYMENT_FLOOR + 10_000;
const to = from + 4_999;
const address = (value) => `0x${value.toString(16).padStart(40, "0")}`;
const insert = (table, values) => sqlite.prepare(`INSERT INTO ${table} (${Object.keys(values).join(",")}) VALUES (${Object.keys(values).map(() => "?").join(",")})`).run(...Object.values(values));
const launch = (id, block, pair = "NVDA") => insert("pons_launches", {
  token_address: address(id), curve_address: address(id + 10_000), deployer_address: address(9_000),
  pair_token_address: address(5_000), pair_symbol: pair, pair_decimals: 18, launch_config_id: 1,
  graduation_threshold_raw: "1000", block_number: block, block_hash: `block-${block}`, block_timestamp: 1_700_000_000 + block - from,
  tx_hash: `launch-${id}`, log_index: 0, token_name: `Token ${id}`, token_symbol: `T${id}`, observed_at: 1,
});
const trade = (id, token, actor, block) => insert("pons_curve_trades", {
  id: `trade-${id}`, curve_address: address(token + 10_000), token_address: address(token), side: id % 2 ? "buy" : "sell",
  actor_address: address(actor), recipient_address: address(actor), quote_amount_raw: "1", token_amount_raw: "2", fee_raw: "0", tax_raw: "0",
  block_number: block, block_hash: `block-${block}`, block_timestamp: 1_700_000_000 + block - from,
  tx_hash: `trade-${id}`, log_index: 0, observed_at: 1,
});
const event = (id, token, type, block) => insert("pons_events", {
  id, event_type: type, token_address: address(token), emitter_address: address(8_000), block_number: block,
  block_hash: `block-${block}`, block_timestamp: 1_700_000_000 + block - from, tx_hash: id, log_index: 0, observed_at: 1,
});
launch(1, from - 1); launch(2, from); launch(3, to); launch(4, to + 1);
trade(0, 1, 100, from - 1);
for (let i = 1; i <= 58; i++) trade(i, i % 2 + 1, 100 + i % 3, i === 1 ? from : i === 58 ? to : from + i);
trade(59, 4, 104, to + 1);
event("old", 4, "graduation", from - 1);
event("g1", 1, "graduation", from);
event("g1-repeat", 1, "graduation", from + 10);
event("g2", 2, "graduation", to);
event("future", 3, "graduation", to + 1);
event("sweep", 3, "sweep", from + 4);
insert("pons_index_state", { id: "pons-v2", locked_until: 0, live_next_block: to + 1, backfill_next_block: from,
  latest_safe_block: to, latest_seen_block: to + 64, consecutive_failures: 0, last_record_count: 0 });

test("pulse drill-down uses the inclusive interval and paginates every trade once", async () => {
  const pages = await Promise.all([0, 25, 50].map((offset) => getPulseEvidence("trades", to, offset)));
  assert.deepEqual(pages.map((page) => page.total), [58, 58, 58]);
  assert.deepEqual(pages.map((page) => page.rows.length), [25, 25, 8]);
  assert.deepEqual(pages.map((page) => page.hasMore), [true, true, false]);
  const rows = pages.flatMap((page) => page.rows);
  assert.equal(new Set(rows.map((row) => row.id)).size, 58);
  assert.equal(rows[0].block, to); assert.equal(rows.at(-1).block, from);
  assert.ok(rows.every((row) => row.symbol && row.txHash));
});
test("actor rows reconcile with distinct wallets and graduation rows with distinct tokens", async () => {
  const actors = await getPulseEvidence("actors", to);
  assert.equal(actors.total, 3);
  assert.equal(actors.rows.reduce((sum, row) => sum + row.trades, 0), 58);
  assert.ok(actors.rows.every((row) => row.tokens === 2));
  const graduations = await getPulseEvidence("graduations", to);
  assert.equal(graduations.total, 2);
  assert.deepEqual(graduations.rows.map((row) => row.id), ["g2", "g1-repeat"]);
  const launches = await getPulseEvidence("launches", to);
  assert.deepEqual(launches.rows.map((row) => row.address), [address(3), address(2)]);
});
test("pulse route rejects uncommitted blocks and malformed requests without writing", async () => {
  for (const query of ["metric=__proto__", "metric=trades&toBlock=1.5", `metric=trades&toBlock=${to}&offset=-1`]) {
    assert.equal((await GET(new Request(`https://site.test/api/pons-pulse?${query}`))).status, 400);
  }
  assert.equal((await GET(new Request(`https://site.test/api/pons-pulse?metric=trades&toBlock=${to + 1}`))).status, 409);
  const before = sqlite.prepare("SELECT total_changes() AS n").get().n;
  const response = await GET(new Request(`https://site.test/api/pons-pulse?metric=graduations&toBlock=${to}`));
  assert.equal(response.status, 200);
  assert.equal((await response.json()).total, 2);
  assert.equal(sqlite.prepare("SELECT total_changes() AS n").get().n, before);
});
test("batched habitat browsing loads 80 candidates while preserving the committed boundary", async () => {
  for (let id = 200; id < 280; id++) launch(id, from + id, "AMD");
  launch(280, to + 1, "AMD");
  const state = { mode: "indexing", generatedAt: new Date().toISOString(), window: { fromBlock: from, toBlock: to },
    index: { latestIndexedBlock: to, liveLagBlocks: 1_000_000, consecutiveFailures: 0 },
    launches: [], tape: [], cohorts: [], flagship: { pair: "AMD" }, pulse: {}, methodology: {}, integrity: {}, collector: { status: "succeeded" } };
  const result = await decorateResearch(state, undefined, { pair: "AMD" });
  assert.equal(result.launches.length, 80);
  assert.ok(result.launches.every((row) => row.pairSymbol === "AMD" && row.blockNumber <= to));
  assert.ok(result.launches.every((row) => row.research.eligible === false && row.research.score === null));
  const graduation = await decorateResearch(state, address(1), { phase: "graduated" });
  assert.ok(graduation.launches.some((row) => row.tokenAddress === address(1) && row.trades === 29));
});
test("a delayed dashboard cannot rewind the feed; newer reorg observations can", () => {
  const first = { lastAttemptAt: "2026-09-08T10:00:00Z", indexedBlock: 100, events: [{ id: "a" }] };
  const next = { lastAttemptAt: "2026-09-08T10:00:12Z", indexedBlock: 120, events: [{ id: "b" }, { id: "a" }] };
  const reorg = { lastAttemptAt: "2026-09-08T10:00:24Z", indexedBlock: 110, events: [{ id: "c" }] };
  assert.equal(latestFactoryFeed(next, first), next);
  assert.equal(latestFactoryFeed(next, reorg), reorg);
  assert.deepEqual(arrivingFactoryEvents(null, next), []);
  assert.deepEqual(arrivingFactoryEvents(first, next), ["b"]);
  assert.deepEqual(arrivingFactoryEvents(next, next), []);
});
test("factory leases prevent concurrent visitors and immediate repeated dispatches", async () => {
  assert.equal(await acquireAuxJob("factory-test", FACTORY_COLLECT_INTERVAL_MS), true);
  assert.equal(await acquireAuxJob("factory-test", FACTORY_COLLECT_INTERVAL_MS), false);
  await releaseAuxJob("factory-test");
  assert.equal(await acquireAuxJob("factory-test", FACTORY_COLLECT_INTERVAL_MS), false);
  sqlite.prepare("UPDATE pons_aux_jobs SET next_at = 0 WHERE id = 'factory-test'").run();
  assert.equal(await acquireAuxJob("factory-test", FACTORY_COLLECT_INTERVAL_MS), true);
  await releaseAuxJob("factory-test");
});
