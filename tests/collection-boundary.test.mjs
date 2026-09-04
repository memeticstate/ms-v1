import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("..", import.meta.url);

async function source(path) {
  return readFile(new URL(path, root), "utf8");
}

test("public snapshot traffic is read-only", async () => {
  const route = await source("app/api/affinity-snapshot/route.ts");
  assert.match(route, /serveAffinitySnapshot/);
  assert.doesNotMatch(route, /collectAffinitySnapshot|runScheduledAffinityCollection|recordSnapshot/);
});

test("worker schedules collection every minute", async () => {
  const [worker, config, cycle] = await Promise.all([
    source("worker/index.ts"),
    source("vite.config.ts"),
    source("lib/ingestion/collector-cycle.ts"),
  ]);
  assert.match(worker, /async scheduled/);
  assert.match(worker, /runScheduledCollectorCycle/);
  assert.match(worker, /\/api\/collector\/heartbeat/);
  assert.match(worker, /\/api\/collector\/history/);
  assert.match(cycle, /Sequential lanes avoid making the same public RPC providers rate-limit each other/);
  assert.match(cycle, /Give each expensive lane its own Worker invocation budget/);
  assert.match(cycle, /v1-current/);
  assert.match(cycle, /v1-legacy/);
  assert.match(config, /crons: \["\* \* \* \* \*"\]/);
});

test("public PONS state reads stay separate from the collection heartbeat", async () => {
  const [route, heartbeat, worker] = await Promise.all([
    source("app/api/pons-state/route.ts"),
    source("app/api/collector/heartbeat/route.ts"),
    source("worker/index.ts"),
  ]);
  assert.match(route, /servePonsState/);
  assert.doesNotMatch(route, /runPonsCollection|persistPonsLogs/);
  assert.match(heartbeat, /request-watchdog/);
  assert.doesNotMatch(heartbeat, /runPonsCollection|persistPonsLogs/);
  assert.match(worker, /runPrimaryCollectorCycle/);
  assert.doesNotMatch(worker, /isPonsTraffic/);
});

test("historical PONS collection has an explicit write boundary", async () => {
  const [route, worker, indexer, ledger] = await Promise.all([
    source("app/api/collector/history/route.ts"),
    source("worker/index.ts"),
    source("lib/ingestion/pons-history.ts"),
    source("db/pons-history-ledger.ts"),
  ]);
  assert.match(route, /accepted: true/);
  assert.match(worker, /runHistoryCollectorCycle/);
  assert.match(indexer, /launch-discovery/);
  assert.match(indexer, /swap-reconstruction/);
  assert.match(ledger, /pons_v1_launches/);
  assert.match(ledger, /pons_v1_swaps/);
  assert.doesNotMatch(await source("app/api/pons-state/route.ts"), /persistPonsV1|runPonsHistoryCollection/);
});

test("collector discovers a ranked cohort instead of using a token allowlist", async () => {
  const [orchestrator, cohort] = await Promise.all([
    source("lib/ingestion/pair-live.ts"),
    source("lib/ingestion/pair-cohort.ts"),
  ]);
  assert.match(orchestrator, /collectPairCohort/);
  assert.match(cohort, /sort=market_cap/);
  assert.match(cohort, /COHORT_SIZE = 12/);
  assert.match(cohort, /\/metrics/);
  assert.match(cohort, /discoveredSpecies: discovery\.total/);
  assert.match(cohort, /two-cycle replacement hysteresis/);
  assert.doesNotMatch(`${orchestrator}\n${cohort}`, /const tracked\s*=|knownIds|allowlist/i);
});

test("deep observations are queryable through a read-only history route", async () => {
  const [route, ledger] = await Promise.all([
    source("app/api/species-history/route.ts"),
    source("db/snapshot-ledger.ts"),
  ]);
  assert.match(route, /listSpeciesHistory/);
  assert.doesNotMatch(route, /recordSnapshot|collectAffinitySnapshot/);
  assert.match(ledger, /species_observations/);
  assert.match(ledger, /affinity_edge_observations/);
});
