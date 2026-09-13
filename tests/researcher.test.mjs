import assert from "node:assert/strict";
import test, { after, beforeEach } from "node:test";
import { readFile, readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";
import { createServer } from "vite";

const root = fileURLToPath(new URL("..", import.meta.url));
const vite = await createServer({ appType: "custom", configFile: false, root, resolve: { alias: { "@": root } }, server: { middlewareMode: true, hmr: false } });
const sqlite = new DatabaseSync(":memory:");
sqlite.exec("PRAGMA foreign_keys=ON");
for (const file of (await readdir(new URL("../drizzle/", import.meta.url))).filter(n => n.endsWith(".sql")).sort()) sqlite.exec(await readFile(new URL(`../drizzle/${file}`, import.meta.url), "utf8"));
let batchWork = Promise.resolve();
const db = {
  prepare(sql) { let values = []; return { bind(...args) { assert.ok(args.length <= 100); values = args; return this; }, async first() { return sqlite.prepare(sql).get(...values) ?? null; }, async all() { return { results: sqlite.prepare(sql).all(...values) }; }, async run() { return { meta: { changes: Number(sqlite.prepare(sql).run(...values).changes) } }; } }; },
  batch(statements) { const work = batchWork.then(async () => { sqlite.exec("BEGIN"); try { const results = []; for (const s of statements) results.push(await s.run()); sqlite.exec("COMMIT"); return results; } catch (error) { sqlite.exec("ROLLBACK"); throw error; } }); batchWork = work.catch(() => undefined); return work; },
};
after(async () => { sqlite.close(); await vite.close(); });
beforeEach(() => sqlite.exec("DELETE FROM research_assignments; DELETE FROM entitlement_usage WHERE capability='researcher_run'"));
const { ResearchStore } = await vite.ssrLoadModule("/db/researcher.ts");
const { researcherResponse } = await vite.ssrLoadModule("/lib/researcher/http.ts");
const { runNextResearch } = await vite.ssrLoadModule("/lib/researcher/runner.ts");
const { investigate } = await vite.ssrLoadModule("/lib/researcher/engine.ts");
const { runResearchAgent, researchModelConfig } = await vite.ssrLoadModule("/lib/researcher/agent.ts");
const { reviewResearch, previousThesis, hasNewReviewEvidence } = await vite.ssrLoadModule("/lib/researcher/review.ts");
const { compareSources, validTaskInput } = await vite.ssrLoadModule("/lib/researcher/model.ts");
const { marketSource, curveSource, recentTimestamp } = await vite.ssrLoadModule("/lib/researcher/sources.ts");
const store = new ResearchStore(db), token = "0x" + "a".repeat(40);
const input = { tokenAddress: token, question: "Is participation broadening?", focus: "participation", cadence: "manual" };
const now = Date.parse("2026-09-10T12:00:00Z");
const source = { id: "index", label: "Indexed history", url: `https://robinhoodchain.blockscout.com/address/${token}`, fetchedAt: new Date(now).toISOString(), evidenceAt: new Date(now - 86400000).toISOString(), freshness: "historical", facts: ["5 trades in an older indexed window."], limitations: ["Historical only."], metrics: { throughBlock: 100, windowBlocks: 25, trades: 5, actors: 3 } };
const report = { version: "researcher-v1", tokenAddress: token, name: "Example", symbol: "EX", question: input.question, generatedAt: new Date(now).toISOString(), mode: "evidence", analysis: null, analysisStatus: "not_configured", sources: [source], changes: ["First observation."], steps: [] };
const gate = async () => ({ access: { active: true, expiresAt: new Date(Date.now() + 120000).toISOString() }, adapter: {} });
const http = (request, userId = "holder", evaluate = gate) => researcherResponse(request, { store, configured: false, authenticate: async () => userId ? { id: userId } : null, evaluate });
const req = (method, value, origin = "https://memeticstate.com") => new Request("https://memeticstate.com/api/premium/researcher", { method, headers: { "content-type": "application/json", origin }, body: JSON.stringify(value) });

test("anonymous, expired and non-holder requests cannot read or enqueue private work", async () => {
  for (const [user, evalGate] of [[null, gate], ["holder", async () => ({ access: { active: false } })], ["holder", async () => ({ access: { active: true, expiresAt: "2020-01-01" } })]]) {
    const response = await http(req("POST", { ...input, action: "create" }), user, evalGate);
    assert.ok([401, 403].includes(response.status));
    assert.equal((await store.list("holder")).length, 0);
    assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM research_runs").get().n, 0);
  }
});
test("private API rejects cross-site writes and oversized or malformed assignments", async () => {
  assert.equal((await http(req("POST", input, "https://evil.example"))).status, 403);
  assert.equal((await http(req("POST", { ...input, question: "x".repeat(7000), action: "create" }))).status, 413);
  assert.equal((await http(req("POST", { ...input, tokenAddress: "https://evil.example", action: "create" }))).status, 422);
  assert.throws(() => validTaskInput({ ...input, question: "bad\u0000question" }));
  assert.equal((await store.list("holder")).length, 0);
});
test("ownership protects assignment reads, runs, edits and deletion", async () => {
  const task = await store.create("alice", input, now);
  for (const operation of [() => store.task("bob", task.id), () => store.runs("bob", task.id), () => store.update("bob", task.id, true, "daily"), () => store.remove("bob", task.id)]) await assert.rejects(operation, /assignment_not_found/);
  assert.equal(await store.enqueue("bob", task.id, now), null);
  const response = await http(new Request(`https://memeticstate.com/api/premium/researcher?id=${task.id}`), "bob");
  assert.equal(response.status, 404);
  assert.doesNotMatch(await response.text(), /participation/);
  assert.match(response.headers.get("cache-control"), /private, no-store/);
});
test("assignment capacity, one active run, cooldown and durable daily allowance hold", async () => {
  const task = await store.create("alice", input, now);
  for (let i = 0; i < 4; i++) await store.create("alice", input, now);
  await assert.rejects(() => store.create("alice", input, now), /assignment_limit/);
  const first = await store.enqueue("alice", task.id, now);
  assert.ok(first); assert.equal(await store.enqueue("alice", task.id, now + 61000), null);
  const job = await store.claim(now); assert.equal(job.id, first); assert.equal(await store.claim(now), null);
  await store.finish(job, "complete", report, null, now + 10);
  assert.equal(await store.enqueue("alice", task.id, now + 20000), null);
  for (let i = 1; i < 12; i++) { assert.ok(await store.enqueue("alice", task.id, now + i * 61000)); await store.finish(await store.claim(now + i * 61000), "complete", report, null, now + i * 61000 + 10); }
  assert.equal(await store.enqueue("alice", task.id, now + 13 * 61000), null);
  await store.remove("alice", task.id);
  const replacement = await store.create("alice", input, now + 14 * 61000);
  assert.equal(await store.enqueue("alice", replacement.id, now + 14 * 61000), null, "deleting work cannot reset quota");
  assert.equal((await store.usage("alice", now)).used, 12);
  assert.ok(await store.enqueue("alice", replacement.id, now + 86400000), "next UTC day resets usage");
});
test("global budget is enforced even for another holder", async () => {
  for (let i = 0; i < 100; i++) sqlite.prepare("INSERT INTO entitlement_usage (id,user_id,capability,units,period_key,idempotency_key,observed_at) VALUES (?,?,'researcher_run',1,'2026-09-10',?,?)").run(`usage-${i}`, `user-${i}`, `usage-${i}`, now / 1000);
  const task = await store.create("new-holder", input, now);
  assert.equal(await store.enqueue("new-holder", task.id, now), null);
});
test("concurrent enqueue attempts create one durable job and one usage entry", async () => {
  const task = await store.create("alice", input, now);
  const ids = await Promise.all(Array.from({ length: 12 }, () => store.enqueue("alice", task.id, now)));
  assert.equal(ids.filter(Boolean).length, 1);
  assert.equal((await store.usage("alice", now)).used, 1);
  const jobs = await Promise.all([store.claim(now), store.claim(now)]);
  assert.equal(jobs.filter(Boolean).length, 1);
});
test("a holder can create, run, revisit and delete an assignment through the private API", async () => {
  const created = await http(req("POST", { ...input, action: "create" }));
  assert.equal(created.status, 200); const saved = await created.json(); assert.ok(saved.runId);
  await runNextResearch(store, { eligible: async () => true, investigate: async (task, previous) => { assert.equal(task.id, saved.assignment.id); assert.equal(previous, null); return report; } });
  const response = await http(new Request(`https://memeticstate.com/api/premium/researcher?id=${saved.assignment.id}`));
  assert.equal(response.status, 200); const workspace = await response.json();
  assert.equal(workspace.runs[0].report.question, input.question); assert.equal(workspace.configured, false);
  assert.equal(workspace.usage.used, 1); assert.match(response.headers.get("cache-control"), /no-store/);
  assert.equal((await http(req("DELETE", { id: saved.assignment.id }))).status, 200);
  assert.equal((await store.list("holder")).length, 0);
});
test("scheduler advances a due assignment once and pause cancels queued work", async () => {
  const task = await store.create("alice", { ...input, cadence: "daily" }, now);
  await store.enqueueDue(now + 86400000); await store.enqueueDue(now + 86400000);
  assert.equal((await store.runs("alice", task.id)).length, 1);
  assert.equal((await store.task("alice", task.id)).nextRunAt, now + 2 * 86400000);
  await store.update("alice", task.id, true, "daily", now + 86400001);
  assert.equal(await store.claim(now + 86400002), null);
  assert.equal((await store.runs("alice", task.id))[0].error, "assignment_paused");
});
test("expired leases are not retried and old workers cannot overwrite reports", async () => {
  const task = await store.create("alice", input, now); await store.enqueue("alice", task.id, now);
  const oldJob = await store.claim(now);
  assert.equal(await store.claim(now + 61000), null);
  assert.ok(await store.enqueue("alice", task.id, now + 62000));
  const newJob = await store.claim(now + 62000);
  await store.finish(oldJob, "complete", report, null, now + 63000);
  assert.equal((await store.runs("alice", task.id)).find(r => r.id === oldJob.id).status, "failed");
  await store.remove("alice", task.id);
  await store.finish(newJob, "complete", report, null, now + 64000);
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM research_runs").get().n, 0);
});
test("background holder loss pauses an assignment before any source or AI call", async () => {
  const task = await store.create("alice", input); await store.enqueue("alice", task.id);
  let called = false;
  await runNextResearch(store, { eligible: async () => false, investigate: async () => { called = true; return report; } });
  assert.equal(called, false); assert.equal((await store.task("alice", task.id)).paused, true);
  assert.equal((await store.runs("alice", task.id))[0].error, "holder_access_required");
});
test("evidence-only run survives source failures and retains a dated baseline", async () => {
  const task = await store.create("alice", input); await store.enqueue("alice", task.id);
  await runNextResearch(store, { eligible: async () => true, investigate: (task, previous) => investigate(task, previous, {
    lookup: async () => ({ tokenAddress: token, name: "Example", symbol: "EX", source: "pons", indexed: false, sourceFetchedAt: new Date().toISOString() }),
    dossier: async () => { throw Error("source down"); }, recent: async () => { throw Error("rpc down"); }, config: null, deadline: Date.now() + 10000,
    fetcher: async () => { throw Error("must never call AI without configuration"); },
  }) });
  const saved = (await store.runs("alice", task.id))[0];
  assert.equal(saved.status, "partial"); assert.equal(saved.report.mode, "evidence"); assert.equal(saved.report.analysis, null);
  assert.equal(saved.report.sources.find(s => s.id === "index").freshness, "unavailable");
  assert.match(saved.report.changes[0], /First observation/);
});
test("timestamp and graduation guards prevent false freshness or zero-activity claims", () => {
  assert.equal(recentTimestamp("invalid", now), false); assert.equal(recentTimestamp(new Date(now + 60000).toISOString(), now), false);
  assert.equal(marketSource(token, { tokenAddress: token, name: "EX", symbol: "EX", source: "pons", sourceStale: true, sourceFetchedAt: new Date(now).toISOString() }, now).freshness, "historical");
  const check = { tokenAddress: token, curveAddress: token, checkedAt: new Date(now).toISOString(), headObservedAt: new Date(now).toISOString(), throughTime: new Date(now - 86400000).toISOString(), fromTime: new Date(now - 90000000).toISOString(), fromBlock: 1, throughBlock: 2000, trades: 0, buys: 0, sells: 0, actors: 0 };
  assert.equal(curveSource(token, check, false, now).freshness, "historical");
  assert.equal(curveSource(token, check, true, now).freshness, "unavailable");
  assert.deepEqual(curveSource(token, check, true, now).metrics, {});
  assert.match(compareSources(report, [{ ...source, metrics: { ...source.metrics, trades: 50 } }])[0], /no newer evidence window/);
});

const finishArgs = { answer: "The available index is historical; current participation remains unknown.", findings: [{ claim: "An older indexed window contains five trades.", sourceIds: ["index"] }], unknowns: ["Current pool trading was not observed."], nextChecks: ["Compare a later dated sample."] };
const output = (name, args, extra = []) => Response.json({ status: "completed", output: [...extra, { type: "function_call", name, call_id: "call1", arguments: JSON.stringify(args) }] });
test("the model chooses a read tool, receives its evidence, and finishes with validated citations", async () => {
  const task = await store.create("alice", input), sources = [{ ...source }]; let calls = 0, reads = 0;
  const analysis = await runResearchAgent({ task, sources, changes: [], config: { key: "test-secret", model: "test-model" }, deadline: Date.now() + 10000,
    read: async name => { reads++; assert.equal(name, "inspect_holder_snapshot"); const next = { ...source, id: "holders" }; sources.push(next); return next; },
    fetcher: async (url, init) => {
      calls++; assert.equal(url, "https://api.openai.com/v1/responses"); assert.equal(init.redirect, "manual");
      const payload = JSON.parse(init.body); assert.equal(payload.store, false); assert.equal(payload.parallel_tool_calls, false);
      assert.doesNotMatch(init.body, /test-secret|user_id|walletAddress|email/);
      if (calls === 1) return output("inspect_holder_snapshot", {}, [{ type: "reasoning", id: "reasoning1", summary: [] }]);
      assert.ok(payload.input.some(item => item.type === "reasoning")); assert.ok(payload.input.some(item => item.type === "function_call_output"));
      return output("finish_research", finishArgs);
    },
  });
  assert.equal(calls, 2); assert.equal(reads, 1); assert.deepEqual(analysis.findings[0].sourceIds, ["index"]);
});
test("unknown tools, URL arguments, unavailable citations and incomplete model output fail closed", async () => {
  const task = await store.create("alice", input);
  for (const response of [output("send_tokens", {}), output("inspect_recent_curve", { url: "https://evil.example" }), output("finish_research", { ...finishArgs, findings: [{ claim: "unsupported", sourceIds: ["made-up"] }] }), Response.json({ status: "incomplete", output: [] })]) {
    let reads = 0;
    await assert.rejects(() => runResearchAgent({ task, sources: [source], changes: [], config: { key: "secret", model: "model" }, deadline: Date.now() + 10000, read: async () => { reads++; return source; }, fetcher: async () => response }));
    assert.equal(reads, 0);
  }
  assert.equal(researchModelConfig({ OPENAI_API_KEY: "secret" }), null);
  assert.equal(researchModelConfig({ MEMETIC_RESEARCH_MODEL: "model" }), null);
});
test("a failing model preserves observations without an invented interpretation", async () => {
  const task = await store.create("alice", input);
  const result = await investigate(task, report, { lookup: async () => null, dossier: async () => null, recent: async () => ({ check: null }), config: { key: "secret", model: "model" }, deadline: Date.now() + 10000, fetcher: async () => Response.json({ error: "unavailable" }, { status: 503 }) });
  assert.equal(result.mode, "evidence"); assert.equal(result.analysisStatus, "unavailable"); assert.equal(result.analysis, null);
  assert.equal(result.sources.length, 2);
});

const reviewArgs = {
  statement: "Participation is broadening in comparable curve windows.", verdict: "unresolved",
  conclusion: "Current participation is unresolved; the available trade window is historical.",
  support: [], challenges: [], unknowns: ["Current pool trading and retained wallet identities are not available."],
  invalidationConditions: ["In a newer complete curve window of the same length, a lower distinct-wallet count would challenge the broadening thesis; missing records alone would not."],
  nextChecks: ["Compare a newer complete curve window before assessing participation."],
  change: "baseline", changeReason: "First reviewed observation.",
  reviewNotes: [{ issue: "The draft could confuse recorded activity with current participation.", resolution: "Withhold a current verdict until a newer comparable observation is available." }],
};
const recentSource = { ...source, freshness: "recent", evidenceAt: new Date(now).toISOString() };
async function makeReview(task, previous = null, args = reviewArgs, sources = [source]) {
  return reviewResearch({ task, previous, sources, draft: finishArgs, config: { key: "secret", model: "model" }, deadline: Date.now() + 10000, fetcher: async () => output("finish_review", args) });
}
test("skeptical review creates dated thesis memory with falsification conditions and source snapshots", async () => {
  const task = await store.create("alice", input);
  const reviewed = await makeReview(task);
  assert.equal(reviewed.thesis.verdict, "unresolved"); assert.equal(reviewed.thesis.change, "baseline");
  assert.equal(reviewed.thesis.sources[0].evidenceAt, source.evidenceAt);
  assert.equal(reviewed.thesis.invalidationConditions.length, 1);
  assert.equal(reviewed.analysis.answer, reviewArgs.conclusion);
  assert.ok(Number.isFinite(Date.parse(reviewed.thesis.reviewedAt)));
});
test("skeptic cannot move the thesis, cite missing evidence, or issue a verdict without support", async () => {
  const task = await store.create("alice", input), first = (await makeReview(task)).thesis;
  await assert.rejects(() => makeReview(task, first, { ...reviewArgs, statement: "A different, easier claim" }), /review_changed_thesis/);
  await assert.rejects(() => makeReview(task, null, { ...reviewArgs, support: [{ claim: "Some fact", sourceIds: ["invented"] }] }), /review_invalid_citation/);
  await assert.rejects(() => makeReview(task, null, { ...reviewArgs, verdict: "supported" }), /review_missing_evidence/);
  await assert.rejects(() => makeReview(task, null, { ...reviewArgs, verdict: "challenged" }), /review_missing_evidence/);
  await assert.rejects(() => makeReview(task, null, { ...reviewArgs, invalidationConditions: [] }));
});
test("historical-only support cannot become a current positive verdict", async () => {
  const task = await store.create("alice", input);
  const reviewed = await makeReview(task, null, { ...reviewArgs, verdict: "supported", conclusion: "Participation is broadening now.", support: [{ claim: "Five recorded trades.", sourceIds: ["index"] }] });
  assert.equal(reviewed.thesis.verdict, "unresolved");
  assert.doesNotMatch(reviewed.analysis.answer, /broadening now/);
});
test("repeated evidence cannot strengthen a thesis and another assignment cannot supply its memory", async () => {
  const task = await store.create("alice", input), prior = (await makeReview(task, null, reviewArgs, [recentSource])).thesis;
  const next = await makeReview(task, prior, { ...reviewArgs, change: "strengthened" }, [recentSource]);
  assert.equal(next.thesis.change, "unresolved"); assert.equal(next.thesis.priorReviewedAt, prior.reviewedAt);
  assert.equal(hasNewReviewEvidence(prior, [recentSource]), false);
  assert.equal(hasNewReviewEvidence(prior, [{ ...recentSource, metrics: { ...recentSource.metrics, throughBlock: 125 } }]), true);
  assert.equal(previousThesis({ ...task, tokenAddress: "0x" + "b".repeat(40) }, { ...report, thesis: prior }), null);
  assert.equal(previousThesis({ ...task, question: "A different question?" }, { ...report, thesis: prior }), null);
});
test("completed pipeline stores the reviewed answer, not the provisional research draft", async () => {
  const task = await store.create("alice", input); let calls = 0;
  const result = await investigate(task, null, { lookup: async () => null, dossier: async () => null, recent: async () => ({ check: null }), config: { key: "secret", model: "model" }, deadline: Date.now() + 25000,
    fetcher: async (_url, init) => {
      calls++; const payload = JSON.parse(init.body);
      if (calls === 1) return output("finish_research", { ...finishArgs, findings: [], answer: "Provisional reading." });
      assert.equal(payload.tools.length, 1); assert.equal(payload.tool_choice.name, "finish_review");
      assert.equal(payload.store, false); assert.doesNotMatch(init.body, /user_id|walletAddress|Authorization|"key":"secret"/);
      return output("finish_review", reviewArgs);
    },
  });
  assert.equal(calls, 2); assert.equal(result.analysis.answer, reviewArgs.conclusion); assert.equal(result.reviewStatus, "complete");
  assert.equal(result.thesis.statement, reviewArgs.statement);
  assert.ok(result.steps.some(s => s.tool === "Skeptic & editor" && s.status === "complete"));
});
test("review failure withholds the draft and preserves earlier memory and evidence without redating them", async () => {
  const task = await store.create("alice", input), prior = (await makeReview(task)).thesis;
  const previous = { ...report, thesis: prior, reviewStatus: "complete" }; let calls = 0;
  const result = await investigate(task, previous, { lookup: async () => null, dossier: async () => null, recent: async () => ({ check: null }), config: { key: "secret", model: "model" }, deadline: Date.now() + 25000,
    fetcher: async () => ++calls === 1 ? output("finish_research", { ...finishArgs, findings: [] }) : Response.json({ error: "timeout" }, { status: 503 }),
  });
  assert.equal(result.mode, "evidence"); assert.equal(result.analysis, null); assert.equal(result.reviewStatus, "unavailable");
  assert.deepEqual(result.thesis, prior); assert.equal(result.thesis.sources[0].evidenceAt, source.evidenceAt);
  await store.enqueue("alice", task.id); const job = await store.claim(); await store.finish(job, "partial", result, null);
  const restored = await store.previous("alice", task.id);
  assert.deepEqual(restored.thesis, prior, "D1 report serialization retains structured memory");
  assert.equal((await store.runs("alice", task.id))[0].report.reviewStatus, "unavailable");
});
test("evidence-only mode carries memory without claiming a review happened", async () => {
  const task = await store.create("alice", input), prior = (await makeReview(task)).thesis;
  const result = await investigate(task, { ...report, thesis: prior }, { lookup: async () => null, dossier: async () => null, recent: async () => ({ check: null }), config: null, deadline: Date.now() + 10000 });
  assert.equal(result.reviewStatus, "not_configured"); assert.deepEqual(result.thesis, prior); assert.equal(result.analysis, null);
});
