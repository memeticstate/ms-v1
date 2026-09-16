import assert from "node:assert/strict";
import test, { after } from "node:test";
import { readFile, readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";
import { createServer } from "vite";

const root = fileURLToPath(new URL("..", import.meta.url));
const vite = await createServer({ appType: "custom", configFile: false, root, resolve: { alias: { "@": root } }, server: { middlewareMode: true, hmr: false } });
const sqlite = new DatabaseSync(":memory:");
for (const file of (await readdir(new URL("../drizzle/", import.meta.url))).filter(name => name.endsWith(".sql")).sort()) sqlite.exec(await readFile(new URL(`../drizzle/${file}`, import.meta.url), "utf8"));
after(async () => { sqlite.close(); await vite.close(); });
let statementCount = 0;
const db = {
  prepare(sql) {
    let values = [];
    return { bind(...args) { assert.ok(args.length <= 100); values = args; return this; },
      async first() { return sqlite.prepare(sql).get(...values) ?? null; },
      async all() { return { results: sqlite.prepare(sql).all(...values) }; },
      async run() { statementCount++; return { meta: { changes: Number(sqlite.prepare(sql).run(...values).changes) } }; },
    };
  },
  async batch(statements) {
    sqlite.exec("BEGIN");
    try { const results = []; for (const statement of statements) results.push(await statement.run()); sqlite.exec("COMMIT"); return results; }
    catch (error) { sqlite.exec("ROLLBACK"); throw error; }
  },
};
const { setRuntimeBindings } = await vite.ssrLoadModule("/db/index.ts"); setRuntimeBindings({ DB: db });
const { summarizeRecentCurveLogs, recentCurveIsFresh } = await vite.ssrLoadModule("/lib/premium/recent-curve.ts");
const { PONS_TOPICS, PONS_V2_FACTORY } = await vite.ssrLoadModule("/lib/pons/constants.ts");
const { persistPonsLogs } = await vite.ssrLoadModule("/db/pons-ledger.ts");
const { refreshRecentCurveCheck, loadRecentCurveCheck } = await vite.ssrLoadModule("/db/premium-recent-curve.ts");
const { readRecentPonsCurve } = await vite.ssrLoadModule("/lib/ingestion/pons-rpc.ts");
const { prepareInsertRows } = await vite.ssrLoadModule("/db/insert-rows.ts");
const address = value => `0x${value.toString(16).padStart(40, "0")}`;
const hash = value => `0x${value.toString(16).padStart(64, "0")}`;
const hex = value => `0x${value.toString(16)}`;
const word = value => BigInt(value).toString(16).padStart(64, "0");
const token = address(10), curve = address(11), launchBlock = 59_990_000, through = 60_000_000;
const rawAmount = (2n ** 200n).toString();
function log(i, side = "buy", overrides = {}) {
  return { address: curve, blockHash: hash(through), blockNumber: hex(through), blockTimestamp: hex(1_700_000_000),
    data: `0x${[rawAmount, 7, 1, 0].map(word).join("")}`, logIndex: hex(i), topics: [side === "buy" ? PONS_TOPICS.curveBuy : PONS_TOPICS.curveSell, hash(i % 3 + 1), hash(90)], transactionHash: hash(i + 100), ...overrides };
}

test("recent checks count the bounded window and preserve lossless evidence", () => {
  const logs = Array.from({ length: 30 }, (_, i) => log(i, i % 2 ? "sell" : "buy"));
  const summary = summarizeRecentCurveLogs([...logs, logs[0]], curve, through - 1999, through, hash(through));
  assert.deepEqual([summary.trades, summary.buys, summary.sells, summary.actors, summary.recentTrades.length], [30, 15, 15, 3, 20]);
  assert.equal(summary.recentTrades[0].id, `${hash(129)}:29`);
  assert.equal(summary.recentTrades.find(t => t.side === "buy").quoteAmountRaw, rawAmount);
  assert.equal(summarizeRecentCurveLogs([], curve, through - 1999, through, hash(through)).trades, 0);
});

test("foreign, conflicting, removed, oversized and out-of-window logs fail closed", () => {
  for (const invalid of [log(0, "buy", { address: address(99) }), log(0, "buy", { removed: true }), log(0, "buy", { blockNumber: hex(through + 1) }), log(0, "buy", { blockHash: hash(999) }), log(0, "buy", { topics: [hash(888)] })]) {
    assert.throws(() => summarizeRecentCurveLogs([invalid], curve, through - 1999, through, hash(through)));
  }
  assert.throws(() => summarizeRecentCurveLogs([log(0), log(0, "sell")], curve, through - 1999, through, hash(through)), /conflicting/);
  assert.throws(() => summarizeRecentCurveLogs(Array.from({ length: 1000 }, (_, i) => log(i)), curve, through - 1999, through, hash(through)), /too_busy/);
});

test("refresh time cannot make an old chain observation fresh", () => {
  const now = Date.now(), check = { checkedAt: new Date(now).toISOString(), headObservedAt: new Date(now - 20_000).toISOString() };
  assert.equal(recentCurveIsFresh(check, now), true);
  for (const headObservedAt of [new Date(now - 150_000).toISOString(), new Date(now + 60_000).toISOString(), "invalid"]) assert.equal(recentCurveIsFresh({ ...check, headObservedAt }, now), false);
  assert.equal(recentCurveIsFresh(check, now + 130_000), false);
});

test("grouped archive writes preserve identities, amounts and idempotent replay", async () => {
  const launch = { ...log(700), address: PONS_V2_FACTORY, blockNumber: hex(launchBlock), blockHash: hash(launchBlock),
    topics: [PONS_TOPICS.launch, hash(10), hash(11), hash(12)], data: `0x${[13, 1, rawAmount].map(word).join("")}` };
  const logs = Array.from({ length: 101 }, (_, i) => log(i, i % 2 ? "sell" : "buy"));
  statementCount = 0;
  const result = await persistPonsLogs({ factoryLogs: [launch], curveLogs: logs, fallbackTimestamp: 1_700_000_000 });
  assert.equal(result.trades, 101);
  assert.equal(result.statements, 19);
  assert.equal(statementCount, 19);
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM pons_curve_trades").get().n, 101);
  assert.equal(sqlite.prepare("SELECT quote_amount_raw FROM pons_curve_trades WHERE side = 'buy' LIMIT 1").get().quote_amount_raw, rawAmount);
  assert.equal(sqlite.prepare("SELECT metadata_status FROM pons_launches WHERE token_address = ?").get(token).metadata_status, "pending");
  await persistPonsLogs({ factoryLogs: [launch], curveLogs: logs, fallbackTimestamp: 1_700_000_000 });
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM pons_curve_trades").get().n, 101);
  assert.throws(() => prepareInsertRows(db, "pons_launches; DROP TABLE pons_events", ["token_address"], [[token]]));
});

function rpc({ reorg = false, wrongChain = false } = {}) {
  let calls = 0;
  const endpoints = new Map();
  return { get calls() { return calls; }, fetcher: async (url, init) => {
    calls++;
    const payload = JSON.parse(init.body);
    const requests = Array.isArray(payload) ? payload : [payload];
    const now = Math.floor(Date.now() / 1000);
    const envelopes = requests.map(request => {
      let result;
      if (request.method === "eth_chainId") result = wrongChain ? "0x1" : "0x1237";
      else if (request.method === "eth_getLogs") {
        assert.equal(request.params[0].address, curve);
        assert.equal(Number(request.params[0].toBlock) - Number(request.params[0].fromBlock) + 1, 2000);
        result = [log(1), log(2, "sell")];
      } else {
        const number = request.params[0] === "latest" ? through + 64 : Number(request.params[0]);
        const key = `${url}:${number}`, count = (endpoints.get(key) ?? 0) + 1; endpoints.set(key, count);
        result = { number: hex(number), hash: reorg && number === through && count % 2 === 0 ? hash(123) : hash(number), timestamp: hex(now - Math.floor((through + 64 - number) / 10)) };
      }
      return { id: request.id, jsonrpc: "2.0", result };
    });
    return Response.json(Array.isArray(payload) ? envelopes : envelopes[0]);
  } };
}

test("direct checks remain separate from the archive and reuse the original cached date", async () => {
  sqlite.prepare("INSERT INTO pons_index_state (id, latest_safe_block, live_next_block) VALUES ('pons-v2', 55000000, 55000001)").run();
  const before = sqlite.prepare("SELECT * FROM pons_index_state").get();
  const originalFetch = globalThis.fetch, transport = rpc(); globalThis.fetch = transport.fetcher;
  try {
    const first = await refreshRecentCurveCheck(token), requests = transport.calls;
    assert.equal(first.check.trades, 2);
    assert.equal(first.check.throughBlock, through);
    assert.equal(first.check.throughHash, hash(through));
    const second = await refreshRecentCurveCheck(token);
    assert.deepEqual(second, first);
    assert.equal(transport.calls, requests);
    assert.deepEqual(sqlite.prepare("SELECT * FROM pons_index_state").get(), before);
    assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM pons_curve_trades").get().n, 101);
    assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM premium_cases").get().n, 0);
    await assert.rejects(refreshRecentCurveCheck(address(404)), /token_not_discovered/);
    assert.equal(transport.calls, requests);
  } finally { globalThis.fetch = originalFetch; }
});

test("reorg and wrong-chain responses are rejected; a failed refresh preserves dated cache", async () => {
  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = rpc({ reorg: true }).fetcher;
    await assert.rejects(readRecentPonsCurve(token, curve, launchBlock), /reorg/);
    const first = await loadRecentCurveCheck(token);
    sqlite.prepare("UPDATE pons_recent_curve_checks SET retry_after = 0").run();
    sqlite.prepare("UPDATE pons_aux_jobs SET next_at = 0, locked_until = 0").run();
    globalThis.fetch = rpc({ wrongChain: true }).fetcher;
    const failed = await refreshRecentCurveCheck(token);
    assert.equal(failed.lastError, "recent_check_unavailable");
    assert.deepEqual(failed.check, first.check);
    assert.equal(sqlite.prepare("SELECT locked_until FROM pons_recent_curve_checks WHERE token_address = ?").get(token).locked_until, 0);
  } finally { globalThis.fetch = originalFetch; }
});

test('new quote assets are indexed before registry discovery and reconciled without changing evidence', async () => {
  const { reconcilePonsQuoteAssets } = await vite.ssrLoadModule('/db/pons-quotes.ts');
  const quote = address(0xabcdef), newToken = address(800), newCurve = address(801);
  const launch = { ...log(800), address: PONS_V2_FACTORY, topics: [PONS_TOPICS.launch, hash(800), hash(801), hash(802)], data: `0x${[quote, 1, rawAmount].map(word).join('')}` };
  await persistPonsLogs({ factoryLogs: [launch], curveLogs: [log(801, 'buy', { address: newCurve })], fallbackTimestamp: 1_700_000_000 });
  const read = () => sqlite.prepare('SELECT * FROM pons_launches WHERE token_address = ?').get(newToken);
  assert.equal(read().pair_token_address, quote);
  assert.match(read().pair_symbol, /^PAIR-/);
  const trades = sqlite.prepare('SELECT * FROM pons_curve_trades').all();
  const events = sqlite.prepare('SELECT * FROM pons_events').all();
  const progress = sqlite.prepare('SELECT * FROM pons_index_state').all();
  const before = read();
  sqlite.prepare(`INSERT INTO robinhood_assets (asset_uid, token_symbol, token_name, status, contract_address, chain_id, token_decimals, content_hash, observed_at, updated_at)
    VALUES ('new-quote', 'FRESH', 'New quote', 'ASSET_STATUS_ACTIVE', ?, 4663, 6, 'hash', 1, 1)`).run(quote);
  await reconcilePonsQuoteAssets();
  assert.deepEqual({ ...read() }, { ...before, pair_symbol: 'FRESH', pair_decimals: 6 });
  assert.deepEqual(sqlite.prepare('SELECT * FROM pons_curve_trades').all(), trades);
  assert.deepEqual(sqlite.prepare('SELECT * FROM pons_events').all(), events);
  assert.deepEqual(sqlite.prepare('SELECT * FROM pons_index_state').all(), progress);
  await reconcilePonsQuoteAssets();
  assert.deepEqual({ ...read() }, { ...before, pair_symbol: 'FRESH', pair_decimals: 6 }, 'reconciliation is idempotent');
  for (const update of ["status = 'ASSET_STATUS_REMOVED', token_symbol = 'REMOVED'", "status = 'ASSET_STATUS_ACTIVE', chain_id = 1, token_symbol = 'WRONGCHAIN'"]) {
    sqlite.exec(`UPDATE robinhood_assets SET ${update} WHERE asset_uid = 'new-quote'`);
    await reconcilePonsQuoteAssets();
    assert.equal(read().pair_symbol, 'FRESH');
  }
  sqlite.exec("UPDATE robinhood_assets SET chain_id = 4663, token_symbol = 'RENAMED', token_decimals = 99 WHERE asset_uid = 'new-quote'");
  await reconcilePonsQuoteAssets();
  assert.equal(read().pair_symbol, 'RENAMED'); assert.equal(read().pair_decimals, 6);
});
