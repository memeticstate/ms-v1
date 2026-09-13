import assert from "node:assert/strict";
import test, { after } from "node:test";
import { readFile, readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";
import { createServer } from "vite";

const root = fileURLToPath(new URL("..", import.meta.url));
const vite = await createServer({ appType: "custom", configFile: false, root, resolve: { alias: { "@": root } }, server: { middlewareMode: true, hmr: false } });
const sqlite = new DatabaseSync(":memory:");
for (const file of (await readdir(new URL("../drizzle/", import.meta.url))).filter((name) => name.endsWith(".sql")).sort()) sqlite.exec(await readFile(new URL(`../drizzle/${file}`, import.meta.url), "utf8"));
after(async () => { sqlite.close(); await vite.close(); });
const db = { prepare(sql) {
  let values = [];
  return {
    bind(...args) { assert.ok(args.length <= 100); values = args; return this; },
    async first() { return sqlite.prepare(sql).get(...values) ?? null; },
    async all() { return { results: sqlite.prepare(sql).all(...values) }; },
    async run() { return { meta: { changes: Number(sqlite.prepare(sql).run(...values).changes) } }; },
  };
} };
const { setRuntimeBindings } = await vite.ssrLoadModule("/db/index.ts"); setRuntimeBindings({ DB: db });
const { premiumResponse } = await vite.ssrLoadModule("/lib/entitlements/premium-boundary.ts");
const { evaluatePremiumAccess } = await vite.ssrLoadModule("/lib/entitlements/token-gate.ts");
const { readTokenGateOnchain, qualifiesForPremium } = await vite.ssrLoadModule("/lib/entitlements/token-adapter.ts");
const { parseResearchRequest, pageEvidence, researchNote } = await vite.ssrLoadModule("/lib/premium/research.ts");
const { readPremiumDossier, premiumTradeQuery, premiumEventQuery, premiumWindowQuery } = await vite.ssrLoadModule("/db/premium-research.ts");
const { documentationRequest } = await vite.ssrLoadModule("/lib/documentation-routing.ts");
const { captureCaseEvidence, compareCaseEvidence, researchQueryForCase, readCaseBody, createCaseInput } = await vite.ssrLoadModule("/lib/premium/cases.ts");
const { researchWorkflow } = await vite.ssrLoadModule("/lib/premium/workflow.ts");
const { createResearchCase, readResearchCase, listResearchCases, updateResearchCase, reviewResearchCase, deleteResearchCase } = await vite.ssrLoadModule("/db/premium-cases.ts");
const address = (value) => `0x${value.toString(16).padStart(40, "0")}`;
const bindings = { MEMETIC_AUTH_MODE: "privy", MEMETIC_TOKEN_ENTITLEMENTS_ENABLED: "true", MEMETIC_TOKEN_CONTRACT_ADDRESS: address(1) };
const insert = (table, row) => sqlite.prepare(`INSERT INTO ${table} (${Object.keys(row).join(",")}) VALUES (${Object.keys(row).map(() => "?").join(",")})`).run(...Object.values(row));
function rpc({ supply = 1_000_000n, balance = 1_000n, divergent = false, wrongChain = false } = {}) {
  let calls = 0;
  return async (_url, init) => {
    const requests = JSON.parse(init.body);
    if (requests[0].method === "eth_chainId") return Response.json([
      { id: 1, result: wrongChain ? "0x1" : "0x1237" }, { id: 2, result: "0x30d40" },
    ]);
    calls++;
    for (const request of requests.filter((row) => row.method === "eth_call")) assert.equal(request.params[1], "0x30d3e", "all state reads use one block");
    return Response.json([
      { id: 1, result: `0x${supply.toString(16)}` }, { id: 2, result: `0x${balance.toString(16)}` }, { id: 3, result: "0x12" },
      { id: 4, result: { hash: "0x" + (divergent ? String(calls) : "a").repeat(64), number: "0x30d3e" } },
    ]);
  };
}

test("every locked identity/access state prevents loading premium data", async () => {
  for (const mode of ["anonymous", "below", "expired", "invalid-expiry", "rpc-down", "identity-down"]) {
    let loaded = false;
    const response = await premiumResponse({
      authenticate: async () => { if (mode === "identity-down") throw Error("offline"); return mode === "anonymous" ? null : { id: "user" }; },
      evaluate: async () => {
        if (mode === "rpc-down") throw Error("offline");
        return { adapter: {}, access: { active: mode !== "below", expiresAt: mode === "invalid-expiry" ? "invalid" : new Date(Date.now() + (mode === "expired" ? -1 : 120000)).toISOString() } };
      },
      load: async () => { loaded = true; return { dossier: "private-data" }; },
    });
    assert.equal(loaded, false, mode);
    assert.ok([401, 403, 503].includes(response.status));
    assert.doesNotMatch(await response.text(), /private-data/);
    assert.match(response.headers.get("cache-control"), /no-store/);
  }
});

test("qualified requests receive a private non-cacheable response", async () => {
  const response = await premiumResponse({ authenticate: async () => ({ id: "user" }), evaluate: async () => ({ adapter: {}, access: { active: true, expiresAt: new Date(Date.now() + 120000).toISOString() } }), load: async () => ({ dossier: { evidence: ["real-source-record"] } }) });
  assert.equal(response.status, 200);
  assert.match(response.headers.get("cache-control"), /private, no-store/);
  assert.match(response.headers.get("vary"), /Authorization/);
  assert.deepEqual((await response.json()).dossier.evidence, ["real-source-record"]);
});

test("0.1% math respects the exact boundary and rounds fractional base units upward", () => {
  assert.equal(qualifiesForPremium(999n, 1_000_000n), false);
  assert.equal(qualifiesForPremium(1_000n, 1_000_000n), true);
  assert.equal(qualifiesForPremium(1n, 1001n), false);
  assert.equal(qualifiesForPremium(2n, 1001n), true);
});

test("quorum checks agree on chain, fixed block and block hash", async () => {
  const verified = await readTokenGateOnchain({ bindings, walletAddress: address(2), fetcher: rpc() });
  assert.equal(verified.blockNumber, 199998);
  assert.equal(verified.confirmations, 2);
  assert.equal(verified.eligible, true);
  await assert.rejects(readTokenGateOnchain({ bindings, walletAddress: address(2), fetcher: rpc({ divergent: true }) }), /quorum_mismatch/);
  await assert.rejects(readTokenGateOnchain({ bindings, walletAddress: address(2), fetcher: rpc({ wrongChain: true }) }), /quorum/);
});

test("a burn cannot lower the pinned requirement; old 0.05% checks cannot grant access", async () => {
  insert("member_profiles", { user_id: "holder", email: "", display_name: "Holder", created_at: 1, updated_at: 1 });
  insert("linked_wallets", { wallet_address: address(2), user_id: "holder", chain_id: 4663, is_primary: 1, verified_at: 1, updated_at: 1, source: "privy" });
  const first = await evaluatePremiumAccess({ db, bindings, userId: "holder", force: true, nowSeconds: 1000, fetcher: rpc() });
  assert.equal(first.access.active, true);
  assert.equal(first.access.requiredBalanceRaw, "1000");
  assert.equal(Date.parse(first.access.expiresAt) - Date.parse(first.access.checkedAt), 120000);
  sqlite.prepare("UPDATE token_gate_checks SET threshold_bps = 5, expires_at = 999999").run();
  const later = await evaluatePremiumAccess({ db, bindings, userId: "holder", nowSeconds: 1100, fetcher: rpc({ supply: 500000n, balance: 600n }) });
  assert.equal(later.access.active, false);
  assert.equal(later.access.requiredBalanceRaw, "1000");
  assert.equal(later.access.supplyReferenceRaw, "1000000");
  assert.equal(sqlite.prepare("SELECT status FROM entitlement_grants WHERE user_id = 'holder'").get().status, "revoked");
  sqlite.prepare("UPDATE linked_wallets SET source = 'manual' WHERE user_id = 'holder'").run();
  const unlinked = await evaluatePremiumAccess({ db, bindings, userId: "holder", fetcher: rpc() });
  assert.equal(unlinked.access.status, "wallet_required");
});

const token = address(10), through = 200000;
insert("pons_launches", { token_address: token, curve_address: address(11), deployer_address: address(12), pair_token_address: address(13), pair_symbol: "NVDA", pair_decimals: 18, launch_config_id: 1, graduation_threshold_raw: "1000", block_number: 100000, block_hash: "launch-block", block_timestamp: 1700000000, tx_hash: "launch-tx", log_index: 0, token_name: "Indexed example", token_symbol: "TEST", observed_at: 1700000000000 });
for (let i = 0; i < 125; i++) insert("pons_curve_trades", { id: `trade-${i}`, curve_address: address(11), token_address: token, side: i % 2 ? "buy" : "sell", actor_address: address(100 + i % 8), recipient_address: address(100), quote_amount_raw: "1234567890123456789", token_amount_raw: "2000", fee_raw: "0", tax_raw: "0", block_number: through, block_hash: "block", block_timestamp: 1700001000, tx_hash: `tx-${i}`, log_index: i, observed_at: 1700001000000 });
insert("pons_events", { id: "lifecycle", event_type: "graduation", token_address: token, emitter_address: address(11), block_number: through, block_hash: "block", block_timestamp: 1700001000, tx_hash: "lifecycle-tx", log_index: 150, observed_at: 1700001000000 });
insert("pons_events", { id: "uncommitted", event_type: "sweep", token_address: token, emitter_address: address(11), block_number: through + 1, block_hash: "block", block_timestamp: 1700001001, tx_hash: "uncommitted-tx", log_index: 151, observed_at: 1700001001000 });
const state = { mode: "degraded", launches: [{ tokenAddress: token, name: "Indexed example", symbol: "TEST", curveAddress: address(11), deployerAddress: address(12), pairTokenAddress: address(13), pairSymbol: "NVDA", launchedAt: "2023-11-14T22:13:20Z", txHash: "launch-tx", research: { label: "Historical", reasons: ["Recorded activity"], next: "Inspect holders" } }], index: { latestIndexedBlock: through, latestSeenBlock: through + 100000, lastSuccessAt: "2023-11-14T22:30:00Z" } };

test("history pagination is stable within a block and excludes uncommitted records", async () => {
  const first = await readPremiumDossier(state, { token, cursor: null, through: null });
  assert.equal(first.history.records.length, 100);
  assert.equal(first.history.records[0].kind, "graduation");
  assert.equal(first.history.records.some((row) => row.id === "uncommitted"), false);
  assert.equal(first.coverage.current, false);
  assert.equal(first.windows[0].trades, 125);
  assert.equal(first.windows[1].trades, 0);
  const query = parseResearchRequest(new URL(`https://example.test/api/premium/research?token=${token}&cursor=${first.history.nextCursor}&through=${through}`));
  const second = await readPremiumDossier(state, query);
  assert.equal(second.history.records.length, 26);
  const ids = [...first.history.records, ...second.history.records].map((row) => row.id);
  assert.equal(new Set(ids).size, 126);
  assert.equal(second.history.nextCursor, null);
  assert.equal(first.token.quoteDecimals, 18);
  assert.equal(first.history.records[1].quoteAmountRaw, "1234567890123456789");
  assert.equal(await readPremiumDossier(state, { token: address(999), cursor: null, through: null }), null);
});

test("queries reject malformed contracts/cursors and preserve the history anchor", () => {
  for (const query of ["token=0x1", `token=${token}&cursor=-1:0`, `token=${token}&cursor=10:2`, `token=${token}&through=NaN`, `token=${token}&through=1e6`]) assert.throws(() => parseResearchRequest(new URL(`https://example.test/?${query}`)));
  const row = { id: "first", transaction: "0xabc", logIndex: 1, blockNumber: 2 };
  assert.equal(pageEvidence([row, { ...row, id: "duplicate" }]).records.length, 1);
});

test("token history and comparison queries use existing token/block indexes", () => {
  for (const [sql, args] of [[premiumTradeQuery, [token, through, through + 1, through + 1, 0, 0, "all", "all", 101]], [premiumEventQuery, [token, through, through + 1, through + 1, 0, 0, "all", "all", 101]], [premiumWindowQuery, [token, through - 25000, through, 5000]]]) {
    const plan = sqlite.prepare(`EXPLAIN QUERY PLAN ${sql}`).all(...args);
    assert.match(plan.map((row) => row.detail).join(" "), /USING INDEX pons_(curve_trades|events)_token_block_idx/);
  }
});

test("delayed or sampled evidence cannot become an unsupported current reading", () => {
  const note = researchNote(state.launches[0], [{ label: "Latest", fromBlock: 1, toBlock: 25000, trades: 5000, actors: 100, sampled: true }], false);
  assert.match(note.label, /Historical/);
  assert.match(note.missing.join(" "), /capped/);
  assert.match(note.missing.join(" "), /retention/);
  assert.ok(note.invalidation.length > 0);
});

test("docs domain routing cannot serve a protected API as a static document", () => {
  assert.equal(new URL(documentationRequest(new Request("https://docs.memeticstate.com/")).url).pathname, "/docs/");
  assert.equal(new URL(documentationRequest(new Request("https://memeticstate.com/docs")).url).pathname, "/docs/");
  assert.equal(documentationRequest(new Request("https://docs.memeticstate.com/api/premium/research")), null);
  assert.equal(documentationRequest(new Request("https://memeticstate.com/")), null);
  assert.equal(documentationRequest(new Request("https://memeticstate.com/docs/", { method: "POST" })), null);
});

test("selected windows and event filters keep the same evidence boundary", async () => {
  for (const [kind, expected] of [["buy", 62], ["sell", 63], ["lifecycle", 1]]) {
    const query = parseResearchRequest(new URL(`https://example.test/?token=${token}&window=5000&kind=${kind}&scope=window&through=${through}`));
    const result = await readPremiumDossier(state, query);
    assert.equal(result.history.records.length, expected);
    assert.ok(result.history.records.every(row => row.blockNumber <= through && (kind === "lifecycle" ? row.kind === "graduation" : row.kind === kind)));
    assert.equal(result.windows[0].fromBlock, through - 4999);
    assert.equal(result.windows[1].toBlock, through - 5000);
  }
  for (const extra of ["window=99999", "kind=DROP", "scope=unknown"]) assert.throws(() => parseResearchRequest(new URL(`https://example.test/?token=${token}&${extra}`)));
});

test("ecology joins exact contracts and does not turn ticker matches into evidence", async () => {
  insert("robinhood_assets", { asset_uid: "wrong", token_symbol: "NVDA", token_name: "Unrelated token", status: "active", contract_address: address(999), chain_id: 4663, content_hash: "wrong", observed_at: Date.now(), updated_at: Date.now() });
  const before = await readPremiumDossier(state, { token, cursor: null, through });
  assert.equal(before.ecology.sources.find(row => row.id === "registry").status, "missing");
  assert.equal(before.ecology.quote, null);
  sqlite.prepare("DELETE FROM robinhood_assets WHERE asset_uid = 'wrong'").run();
  insert("robinhood_assets", { asset_uid: "correct", token_symbol: "NVDA", token_name: "Matched quote asset", status: "active", contract_address: address(13), chain_id: 4663, content_hash: "correct", observed_at: Date.now(), updated_at: Date.now() });
  const template = sqlite.prepare("SELECT * FROM pons_launches WHERE token_address = ?").get(token);
  insert("pons_launches", { ...template, token_address: address(20), curve_address: address(21), pair_token_address: address(13), token_symbol: "EXACT", tx_hash: "peer-exact" });
  insert("pons_launches", { ...template, token_address: address(22), curve_address: address(23), pair_token_address: address(999), token_symbol: "SAME-TICKER", tx_hash: "peer-wrong" });
  const after = await readPremiumDossier(state, { token, cursor: null, through });
  assert.equal(after.ecology.sources.find(row => row.id === "registry").status, "recorded");
  assert.ok(after.ecology.peers.some(row => row.symbol === "EXACT"));
  assert.ok(!after.ecology.peers.some(row => row.symbol === "SAME-TICKER"));
  assert.equal(after.ecology.sources.find(row => row.id === "pons").stale, true);
  assert.match(after.ecology.limitation, /not a synchronized/);
});

test("case evidence is captured from server records and can replay an older page", async () => {
  const dossier = await readPremiumDossier(state, { token, cursor: null, through });
  assert.equal(captureCaseEvidence(dossier).capturedRecords, 20);
  assert.throws(() => captureCaseEvidence(dossier, ["client-invented-id"]), error => error.code === "evidence_window_changed");
  assert.throws(() => captureCaseEvidence({ ...dossier, note: { ...dossier.note, interpretation: "x".repeat(70000) } }), error => error.code === "case_evidence_too_large");
  const olderQuery = { token, through, window: 25000, kind: "all", scope: "all", cursor: dossier.history.nextCursor };
  const older = await readPremiumDossier(state, researchQueryForCase(olderQuery));
  assert.equal(older.history.pageCursor, olderQuery.cursor);
  const selected = captureCaseEvidence(older, [older.history.records.at(-1).id]);
  assert.equal(selected.capturedRecords, 1);
  const review = researchQueryForCase(olderQuery, true);
  assert.equal(review.cursor, null); assert.equal(review.through, null); assert.equal(review.windowBlocks, 25000);
});

test("private cases enforce ownership, preserve original evidence, and reject lost updates", async () => {
  const evidence = captureCaseEvidence(await readPremiumDossier(state, { token, cursor: null, through }));
  const id = "12345678-1234-4234-8234-123456789abc";
  const fields = { title: "Breadth thesis", thesis: "Compare participation", invalidationNote: "Reconsider if breadth deteriorates", outcomeNote: "", status: "open" };
  const input = { ...fields, id, query: { token, through, window: 25000, kind: "all", scope: "all" } };
  const created = await createResearchCase("case-owner", input, evidence);
  const replay = await createResearchCase("case-owner", { ...input, title: "Do not overwrite" }, evidence);
  assert.equal(replay.title, "Breadth thesis");
  assert.deepEqual(await listResearchCases("other-owner"), []);
  for (const operation of [() => readResearchCase("other-owner", id), () => updateResearchCase("other-owner", id, 1, fields), () => reviewResearchCase("other-owner", id, 1, evidence), () => deleteResearchCase("other-owner", id, 1)]) await assert.rejects(operation(), error => error.status === 404);
  const edited = await updateResearchCase("case-owner", id, created.version, { ...fields, outcomeNote: "Still investigating" });
  await assert.rejects(updateResearchCase("case-owner", id, created.version, fields), error => error.code === "case_changed_reload");
  const originalBytes = JSON.stringify(edited.original);
  const review = structuredClone(evidence); review.dossier.coverage.throughBlock += 5000; review.dossier.windows[0].trades += 10;
  const reviewed = await reviewResearchCase("case-owner", id, edited.version, review);
  assert.equal(JSON.stringify(reviewed.original), originalBytes);
  assert.equal(compareCaseEvidence(reviewed.original, reviewed.latestReview).trades, 10);
  assert.equal(compareCaseEvidence(reviewed.original, reviewed.latestReview).advanced, true);
  await assert.rejects(deleteResearchCase("case-owner", id, edited.version), error => error.code === "case_changed_reload");
  await deleteResearchCase("case-owner", id, reviewed.version);
  await assert.rejects(readResearchCase("case-owner", id), error => error.status === 404);
});

test("the case capacity is enforced in the insert even under competing requests", async () => {
  const evidence = captureCaseEvidence(await readPremiumDossier(state, { token, cursor: null, through }));
  const input = { title: "Capacity", thesis: "Test thesis", invalidationNote: "Test observation", outcomeNote: "", status: "open", query: { token, through, window: 25000, kind: "all", scope: "all" } };
  for (let i = 0; i < 49; i++) await createResearchCase("capacity-owner", { ...input, id: `capacity-${i}` }, evidence);
  const outcomes = await Promise.allSettled([49, 50].map(i => createResearchCase("capacity-owner", { ...input, id: `capacity-${i}` }, evidence)));
  assert.equal(outcomes.filter(row => row.status === "fulfilled").length, 1);
  assert.equal((await listResearchCases("capacity-owner")).length, 50);
  const plan = sqlite.prepare("EXPLAIN QUERY PLAN SELECT id FROM premium_cases WHERE user_id = ? ORDER BY updated_at DESC LIMIT 50").all("capacity-owner");
  assert.match(plan.map(row => row.detail).join(" "), /premium_cases_user_updated_idx/);
});

test("request limits apply to actual body bytes and input cannot choose an owner", async () => {
  await assert.rejects(readCaseBody(new Request("https://example.test/", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ text: "x".repeat(25000) }) })), error => error.status === 413);
  await assert.rejects(readCaseBody(new Request("https://example.test/", { method: "POST", body: "not-json" })), error => error.status === 415);
  const input = createCaseInput.parse({ id: "12345678-1234-4234-8234-123456789abc", userId: "injected-owner", title: "Thesis", thesis: "Participation", invalidationNote: "A later observation", query: { token, through, window: 25000 } });
  assert.equal(input.userId, undefined);
  const response = await premiumResponse({ authenticate: async () => ({ id: "authenticated-owner" }), evaluate: async () => ({ access: { active: true, expiresAt: new Date(Date.now() + 120000).toISOString() } }), load: async user => ({ owner: user.id }) });
  assert.equal((await response.json()).owner, "authenticated-owner");
});

test("invalidation paths and case comparisons keep missing or sampled evidence unresolved", async () => {
  const dossier = await readPremiumDossier(state, { token, cursor: null, through });
  const flow = researchWorkflow(dossier);
  assert.equal(flow.invalidationPaths.find(row => row.id === "freshness").status, "unresolved");
  assert.equal(flow.invalidationPaths.find(row => row.id === "retention").status, "unresolved");
  assert.equal(flow.prompts.length, 3);
  const evidence = captureCaseEvidence(dossier), sampled = structuredClone(evidence);
  sampled.dossier.windows[0].sampled = true;
  assert.equal(compareCaseEvidence(evidence, sampled).comparable, false);
  assert.equal(compareCaseEvidence(evidence, sampled).trades, null);
});
