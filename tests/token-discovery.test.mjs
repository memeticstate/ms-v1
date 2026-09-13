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
for (const file of (await readdir(new URL("../drizzle/", import.meta.url))).filter(name => name.endsWith(".sql")).sort()) sqlite.exec(await readFile(new URL(`../drizzle/${file}`, import.meta.url), "utf8"));
after(async () => { sqlite.close(); await vite.close(); });
const binding = { prepare(sql) { let args = []; return {
  bind(...values) { assert.ok(values.length <= 100); args = values; return this; },
  async first() { return sqlite.prepare(sql).get(...args) ?? null; },
  async all() { return { results: sqlite.prepare(sql).all(...args) }; },
  async run() { return { meta: { changes: Number(sqlite.prepare(sql).run(...args).changes) } }; },
}; }, async batch(statements) { return Promise.all(statements.map(statement => statement.run())); } };
const { setRuntimeBindings } = await vite.ssrLoadModule("/db/index.ts");
setRuntimeBindings({ DB: binding });
const { searchIndexedTokens, saveDiscoveryCache, loadDiscoveryCache } = await vite.ssrLoadModule("/db/token-discovery.ts");
const { rankTokenMatches, searchTokens, loadTokenDiscovery, loadCachedTokenDiscovery } = await vite.ssrLoadModule("/lib/tokens/discovery.ts");
const { tokenTitle, tokenAddress, safeTokenImage } = await vite.ssrLoadModule("/lib/tokens/model.ts");
const { parsePonsToken, fetchPonsJson } = await vite.ssrLoadModule("/lib/tokens/pons-source.ts");
const { radarReadings } = await vite.ssrLoadModule("/lib/tokens/radar.ts");
const address = n => `0x${n.toString(16).padStart(40, "0")}`;
const now = Date.now(), time = new Date(now - 1000).toISOString();
const market = { tokenAddress: address(1), name: "Test One", symbol: "TEST", source: "pons", indexed: false, sourceFetchedAt: time,
  latestBuyAt: time, launchedAt: new Date(now - 3 * 86400_000).toISOString(), graduated: true, marketCapUsd: 200_000 };
const insertLaunch = (id, name, symbol) => sqlite.prepare(`INSERT INTO pons_launches (token_address, curve_address, deployer_address, pair_token_address, pair_symbol, pair_decimals,
  launch_config_id, graduation_threshold_raw, block_number, block_hash, block_timestamp, tx_hash, log_index, token_name, token_symbol, observed_at)
  VALUES (?, ?, ?, ?, 'ETH', 18, 1, '0', ?, 'hash', 1, ?, 0, ?, ?, 1)`)
  .run(address(id), address(id + 10000), address(5000), address(0), id, `tx-${id}`, name, symbol);
for (let i = 1; i <= 160; i++) insertLaunch(i, i === 1 ? "Needle Token" : `Example ${i}`, i === 1 ? "NEEDLE" : `EX${i}`);

test("a full-index search finds an older token outside the visible top 120 and treats wildcard input literally", async () => {
  const result = await searchIndexedTokens("needle");
  assert.equal(result[0].tokenAddress, address(1));
  assert.equal((await searchIndexedTokens(address(1).toUpperCase().replace("0X", "0x")))[0].tokenAddress, address(1));
  assert.deepEqual(await searchIndexedTokens("%_"), []);
  assert.deepEqual(await searchIndexedTokens("' OR 1=1 --"), []);
});

test("older PONS generations are searchable by name as well as CA", async () => {
  sqlite.prepare(`INSERT INTO pons_v1_launches (token_address, generation, factory_address, deployer_address, dex_factory_address,
    pair_token_address, pair_symbol, pool_address, dex_id, launch_config_id, position_id, restrictions_end_block, initial_buy_amount_raw,
    block_number, block_hash, block_timestamp, tx_hash, log_index, observed_at, token_name, token_symbol)
    VALUES (?, 'v1-legacy', ?, ?, ?, ?, 'ETH', ?, '1', '1', '1', '0', '0', 1, 'hash', 1, 'old-launch', 0, 1, 'Older Generation', 'OLDER')`)
    .run(address(900), address(901), address(902), address(903), address(0), address(904));
  assert.equal((await searchIndexedTokens("Older Generation"))[0].tokenAddress, address(900));
  assert.equal((await searchIndexedTokens(address(900)))[0].symbol, "OLDER");
});

test("search ranks exact ticker matches first, deduplicates contracts, and never replaces an exact CA with a different token", () => {
  const other = { ...market, tokenAddress: address(2), name: "Test", symbol: "TEST2", marketCapUsd: 1e9 };
  assert.equal(rankTokenMatches([other, market], "TEST")[0].tokenAddress, address(1));
  const records = rankTokenMatches([{ ...market, name: "Onchain name", source: "index", indexed: true }, market], "TEST");
  assert.equal(records.length, 1); assert.equal(records[0].name, "Onchain name"); assert.equal(records[0].indexed, true);
  assert.deepEqual(rankTokenMatches([market], address(8)), []);
});

test("missing identities retain distinguishable CAs and unsafe metadata cannot become an image request", () => {
  assert.equal(tokenTitle({ tokenAddress: address(1), name: "Name unresolved", symbol: "—" }), "0x0000…000001");
  assert.equal(tokenTitle({ tokenAddress: address(1), name: "Actual name", symbol: "—" }), "Actual name");
  assert.equal(tokenAddress("javascript:alert(1)"), null);
  assert.equal(safeTokenImage("https://127.0.0.1/image.png"), null);
  assert.equal(safeTokenImage("https://www.ponsfamily.com.attacker.test/api/ipfs/content/test"), null);
  assert.equal(safeTokenImage("ipfs://bafyTest"), "https://www.ponsfamily.com/api/ipfs/content/bafyTest?variant=card");
  const token = parsePonsToken({ token: address(1), name: "Valid\u202ename", symbol: "OK", logo: "ipfs://bafyTest", marketCapUsd: -1 }, time);
  assert.equal(token.name, "Validname"); assert.equal(token.marketCapUsd, null);
});

test("radar excludes historical, future-dated and stale source observations even when fetched just now", () => {
  const discovery = { markets: [market, { ...market, tokenAddress: address(2), latestBuyAt: "2026-09-05T14:58:00Z" },
    { ...market, tokenAddress: address(3), sourceStale: true }, { ...market, tokenAddress: address(4), latestBuyAt: new Date(now + 3600_000).toISOString() }], launches: [], fetchedAt: time };
  const rows = radarReadings(null, discovery, "changes", now);
  assert.equal(rows.length, 1); assert.equal(rows[0].token.tokenAddress, address(1));
  assert.equal(rows[0].kind, "market"); assert.equal(rows[0].tone, "neutral");
  assert.match(rows[0].uncertainty, /do not establish/);
  assert.deepEqual(radarReadings(null, discovery, "changes", now + 121_000), []);
});

test("new launches use the launch date and never relabel a buy as the last trade", () => {
  const token = { ...market, graduated: false, launchedAt: time };
  const [row] = radarReadings(null, { markets: [], launches: [token] }, "launches", now);
  assert.equal(row.kind, "launch"); assert.equal(row.evidenceAt, time);
  assert.equal(row.evidenceLabel, "Launch reported by PONS");
  const [trading] = radarReadings(null, { markets: [market], launches: [] }, "changes", now);
  assert.equal(trading.evidenceLabel, "Latest buy reported by PONS");
});

test("upstream search failure still returns local matches and labels incomplete coverage", async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error("upstream_down"); };
  try {
    const result = await searchTokens("Needle Token");
    assert.equal(result.partial, true); assert.equal(result.results[0].tokenAddress, address(1));
  } finally { globalThis.fetch = original; }
});

test("an unnamed indexed contract receives its recovered identity when the catalog is unavailable", async () => {
  insertLaunch(170, null, null);
  await saveDiscoveryCache(`token:${address(170)}`, { tokenAddress: address(170), name: "Recovered Token", symbol: "RECOVERED", source: "contract", indexed: false }, 60_000);
  const original = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error("upstream_down"); };
  try {
    const result = await searchTokens(address(170));
    assert.equal(result.results.length, 1);
    assert.equal(result.results[0].name, "Recovered Token");
    assert.equal(result.results[0].symbol, "RECOVERED");
    assert.equal(result.results[0].indexed, true);
  } finally { globalThis.fetch = original; }
});

test("a discovered token remains searchable by its name and ticker without canonical metadata or an available catalog", async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error("upstream_down"); };
  try {
    for (const query of ["Recovered Token", "$RECOVERED"]) {
      const result = await searchTokens(query);
      assert.equal(result.results[0].tokenAddress, address(170));
      assert.equal(result.results[0].name, "Recovered Token");
      assert.equal(result.partial, true);
    }
  } finally { globalThis.fetch = original; }
});

test("live discovery preserves upstream identities and has a durable cache without writing canonical chain records", async () => {
  const original = globalThis.fetch;
  const launchCount = sqlite.prepare("SELECT COUNT(*) AS n FROM pons_launches").get().n;
  let calls = 0;
  globalThis.fetch = async (url, options) => {
    assert.equal(options.redirect, "manual", "catalog fetch must use an edge-supported mode without following redirects");
    calls++;
    const token = { token: address(600), symbol: "CATALOG", name: "Catalog token", logo: "ipfs://bafyTest", graduated: true, marketCapUsd: 100_000, latestBuyAt: time, launchedAt: time };
    return Response.json(String(url).includes("graduations") ? [token] : { generatedAt: now, active: { items: [token] } });
  };
  try {
    const first = await loadTokenDiscovery(), second = await loadTokenDiscovery();
    assert.equal(first.markets[0].symbol, "CATALOG"); assert.equal(second.launches[0].tokenAddress, address(600));
    assert.equal(calls, 2);
    assert.equal((await loadDiscoveryCache(`token:${address(600)}`)).value.imageUrl, "https://www.ponsfamily.com/api/ipfs/content/bafyTest?variant=card");
    assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM pons_launches").get().n, launchCount);
  } finally { globalThis.fetch = original; }
});

test("token image endpoint rejects arbitrary servers without making a network request", async () => {
  const { GET } = await vite.ssrLoadModule("/app/api/token-image/route.ts");
  const original = globalThis.fetch;
  globalThis.fetch = async () => { assert.fail("unsafe image destination fetched"); };
  try { assert.equal((await GET(new Request("https://example.test/api/token-image?src=https://localhost/secret"))).status, 400); }
  finally { globalThis.fetch = original; }
});

test("an expired radar held by another refresh is marked incomplete until newer observations arrive", async () => {
  const old = now - 300_000;
  sqlite.prepare("UPDATE token_discovery_cache SET fetched_at = ?, expires_at = ? WHERE key LIKE 'radar:%'").run(old, old);
  sqlite.prepare("UPDATE pons_aux_jobs SET locked_until = ?, next_at = ? WHERE id LIKE 'discovery-%'").run(now + 60_000, now + 60_000);
  const result = await loadTokenDiscovery();
  assert.equal(result.partial, true);
  assert.equal(Date.parse(result.fetchedAt), old);
  const original = globalThis.fetch;
  globalThis.fetch = async () => { assert.fail("cached discovery must not wait for upstream"); };
  try {
    const cached = await loadCachedTokenDiscovery();
    assert.equal(cached.partial, true);
    assert.equal(Date.parse(cached.fetchedAt), old);
    assert.equal(cached.markets[0].symbol, "CATALOG");
  } finally { globalThis.fetch = original; }
});

test("catalog and icon requests reject redirects without following the destination", async () => {
  const { GET } = await vite.ssrLoadModule("/app/api/token-image/route.ts");
  const original = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async (_url, options) => {
    calls++;
    assert.equal(options.redirect, "manual");
    return new Response(null, { status: 302, headers: { location: "https://unexpected.test/asset" } });
  };
  try {
    await assert.rejects(fetchPonsJson("/api/pons-launches"), /pons_source_302/);
    const response = await GET(new Request("https://example.test/api/token-image?src=" + encodeURIComponent("https://www.ponsfamily.com/api/ipfs/content/bafyTest")));
    assert.equal(response.status, 404);
    assert.equal(calls, 2);
  } finally { globalThis.fetch = original; }
});

test("the factory feed resolves identities in one SQLite read without moving archive progress", async () => {
  const { storeFactoryFeed, loadFactoryFeed } = await vite.ssrLoadModule("/db/pons-factory.ts");
  const before = sqlite.prepare("SELECT * FROM pons_index_state").all();
  const events = Array.from({ length: 150 }, (_, i) => ({ id: `event-${i}`, tokenAddress: address(i + 1),
    tokenSymbol: "—", pairSymbol: "—", eventType: "launch", blockNumber: i + 1, observedAt: time, txHash: `tx-${i}`, detail: "Launch" }));
  await storeFactoryFeed({ fromBlock: 1, indexedBlock: 150, indexedHash: "hash", headBlock: 214, observedAt: time,
    lastAttemptAt: time, lastError: null, consecutiveFailures: 0, events });
  const feed = await loadFactoryFeed();
  assert.equal(feed.events.length, 150);
  assert.equal(feed.events[0].tokenSymbol, "NEEDLE");
  assert.equal(feed.events[149].tokenSymbol, "EX150");
  assert.equal(feed.events[0].pairSymbol, "ETH");
  assert.deepEqual(sqlite.prepare("SELECT * FROM pons_index_state").all(), before);
});
