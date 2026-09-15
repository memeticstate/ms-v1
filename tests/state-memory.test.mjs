import assert from "node:assert/strict";
import test, { after, beforeEach } from "node:test";
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
beforeEach(() => { sqlite.exec("DELETE FROM pons_token_state_history; DELETE FROM pons_launches;"); });
const { setRuntimeBindings } = await vite.ssrLoadModule("/db/index.ts");
setRuntimeBindings({ DB: { prepare(sql) {
  assert.match(sql.trim(), /^SELECT\b/i, "history and transition readers must remain read-only");
  let values = [];
  return {
    bind(...args) { assert.ok(args.length <= 100, "D1 bind limit"); values = args; return this; },
    async all() { return { results: sqlite.prepare(sql).all(...values) }; },
  };
} } });
const { loadPonsTokenTransitions, loadPonsTokenStateHistory, loadRecentPonsStateChanges } = await vite.ssrLoadModule("/db/pons-research.ts");
const { GET: historyGet } = await vite.ssrLoadModule("/app/api/token-state-history/route.ts");
const { GET: changesGet } = await vite.ssrLoadModule("/app/api/state-changes/route.ts");
const { watchEntrySchema } = await vite.ssrLoadModule("/lib/pons/watch-schema.ts");
const { createWatchEntry } = await vite.ssrLoadModule("/lib/pons/watchlist.ts");

const now = Date.now();
const address = (id) => `0x${id.toString(16).padStart(40, "0")}`;
const insert = (table, values) => sqlite.prepare(`INSERT INTO ${table} (${Object.keys(values).join(",")}) VALUES (${Object.keys(values).map(() => "?").join(",")})`).run(...Object.values(values));
function launch(id) {
  insert("pons_launches", {
    token_address: address(id), curve_address: address(id + 10_000), deployer_address: address(9_000),
    pair_token_address: address(5_000), pair_symbol: "ETH", pair_decimals: 18, launch_config_id: 1,
    graduation_threshold_raw: "1000", block_number: 100, block_hash: `block-${id}`, block_timestamp: 1_700_000_000,
    tx_hash: `launch-${id}`, log_index: 0, token_name: `Token ${id}`, token_symbol: `T${id}`, observed_at: now,
  });
}
function memory(id, at, signal, changeKind, extra = {}) {
  const eligible = ["steady", "broadening", "surging"].includes(signal) ? 1 : 0;
  insert("pons_token_state_history", {
    id: `${id}:${at}`, token_address: address(id), observed_at: at, indexed_block: 100,
    phase: "bonding", signal, eligible, evidence_status: "ok", holder_sample_size: 15,
    meaningful_holders: 12, holder_qualified: 1, recent_trades: 42, previous_trades: 40,
    recent_actors: 22, previous_actors: 20, change_kind: changeKind,
    payload_json: JSON.stringify({ researchLabel: `Reading: ${signal}`, researchReasons: [`Recorded ${signal} evidence.`], watchNext: "Check the next observation." }),
    ...extra,
  });
}

test("heartbeats neither manufacture transitions nor replace the most recent real change", async () => {
  memory(1, now - 4000, "unverified", "initial");
  memory(1, now - 3000, "stressed", "signal");
  memory(1, now - 2000, "stressed", "heartbeat");
  memory(1, now - 1000, "stressed", "heartbeat");
  memory(2, now - 2000, "steady", "initial");
  memory(2, now - 1000, "steady", "heartbeat");
  const transitions = await loadPonsTokenTransitions([address(1), address(2)]);
  const transition = transitions.get(address(1));
  assert.equal(transition.from, "unverified");
  assert.equal(transition.to, "stressed");
  assert.equal(transition.kind, "deteriorated");
  assert.equal(transition.observedAt, new Date(now - 3000).toISOString());
  assert.equal(transitions.has(address(2)), false);
});

test("stress clearing, recovery, lifecycle, and material evidence changes retain their canonical meanings", async () => {
  for (const [id, next] of [[1, "unverified"], [2, "steady"]]) {
    memory(id, now - 3000, "stressed", "initial");
    memory(id, now - 2000, next, "signal,eligibility");
    memory(id, now - 1000, next, "heartbeat");
  }
  memory(3, now - 2000, "steady", "initial");
  memory(3, now - 1000, "steady", "evidence", { evidence_status: "partial" });
  memory(4, now - 2000, "steady", "initial");
  memory(4, now - 1000, "unverified", "signal,lifecycle", { phase: "graduated" });
  const transitions = await loadPonsTokenTransitions([1, 2, 3, 4].map(address));
  assert.equal(transitions.get(address(1)).kind, "stress-cleared");
  assert.equal(transitions.get(address(1)).label, "Stress is no longer confirmed");
  assert.doesNotMatch(transitions.get(address(1)).label, /recover/i);
  assert.equal(transitions.get(address(2)).kind, "recovered");
  assert.equal(transitions.get(address(2)).to, "steady");
  assert.equal(transitions.get(address(3)).kind, "evidence-update");
  assert.equal(transitions.get(address(4)).kind, "lifecycle");
});

test("token history is bounded, ordered, and composed only of persisted material observations", async () => {
  for (let index = 0; index < 43; index++) memory(1, now - 100_000 + index * 1000, index % 2 ? "steady" : "stressed", index ? "signal" : "initial");
  memory(1, now - 1000, "stressed", "heartbeat");
  const history = await loadPonsTokenStateHistory(address(1));
  assert.equal(history.records.length, 40);
  assert.equal(history.partial, true);
  assert.equal(history.records[0].observedAt, new Date(now - 58_000).toISOString());
  assert.equal(history.records[0].label, "Reading: stressed");
  assert.ok(history.records.every((record) => !record.changeKinds.includes("heartbeat")));
  assert.deepEqual(await loadPonsTokenStateHistory(address(9)), { tokenAddress: address(9), records: [], partial: false });
});

test("changed feed includes persisted deterioration outside the current eligible cohort and bounds coverage", async () => {
  for (let id = 1; id <= 63; id++) {
    launch(id);
    memory(id, now - 10_000 - id, "steady", "initial");
    memory(id, now - id, "stressed", "signal,eligibility");
  }
  launch(70);
  memory(70, now - 1000, "unverified", "initial");
  memory(70, now - 10, "unverified", "heartbeat");
  launch(80);
  memory(80, now - 3 * 86_400_000, "stressed", "initial");
  memory(80, now - 2 * 86_400_000, "inactive", "signal");
  const result = await loadRecentPonsStateChanges(undefined, now);
  assert.equal(result.limit, 60);
  assert.equal(result.changes.length, 60);
  assert.equal(result.partial, true);
  assert.equal(result.changes[0].tokenAddress, address(1));
  assert.ok(result.changes.every((change) => change.transition.kind === "deteriorated"));
  assert.equal(result.changes.some((change) => [address(70), address(80)].includes(change.tokenAddress)), false);
  const watched = await loadRecentPonsStateChanges([address(80)], now);
  assert.equal(watched.changes[0].transition.kind, "inactive");
  assert.equal(watched.changes[0].symbol, "T80");
  assert.equal(watched.partial, false);
});

test("history and changes endpoints validate addresses, retain no-store, and do not fabricate missing history", async () => {
  assert.equal((await historyGet(new Request("https://example.test/api/token-state-history?token=bad"))).status, 400);
  assert.equal((await changesGet(new Request("https://example.test/api/state-changes?tokens="))).status, 400);
  const tooMany = Array.from({ length: 51 }, (_, i) => address(i + 1)).join(",");
  assert.equal((await changesGet(new Request(`https://example.test/api/state-changes?tokens=${tooMany}`))).status, 400);
  const history = await historyGet(new Request(`https://example.test/api/token-state-history?token=${address(1)}`));
  assert.equal(history.status, 200);
  assert.equal(history.headers.get("cache-control"), "no-store");
  assert.deepEqual(await history.json(), { tokenAddress: address(1), records: [], partial: false });
  const changes = await changesGet(new Request(`https://example.test/api/state-changes?tokens=${address(1)}`));
  assert.deepEqual(await changes.json(), { changes: [], limit: 60, partial: false });
});

test("Watchtower accepts canonical unresolved and negative states without changing validation or discovery eligibility", () => {
  const launch = { tokenAddress: address(1), name: "Token", symbol: "TKN", pairSymbol: "ETH", pairColor: "#8fa876",
    signal: "steady", phase: "bonding", recentTrades: 42, momentumPercent: null, attentionScore: 0 };
  for (const signal of ["surging", "broadening", "forming", "steady", "cooling", "quiet", "historical", "unverified", "inactive", "stressed"]) {
    const watch = createWatchEntry({ ...launch, signal });
    assert.equal(watchEntrySchema.safeParse(watch).success, true, signal);
  }
  assert.equal(watchEntrySchema.safeParse(createWatchEntry({ ...launch, signal: "recovered" })).success, false);
  assert.equal(watchEntrySchema.safeParse(createWatchEntry({ ...launch, tokenAddress: "invalid" })).success, false);
});
