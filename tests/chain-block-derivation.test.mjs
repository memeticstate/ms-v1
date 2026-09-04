import assert from "node:assert/strict";
import test, { after } from "node:test";
import { fileURLToPath } from "node:url";

import { createServer } from "vite";

const root = fileURLToPath(new URL("..", import.meta.url));
const vite = await createServer({
  appType: "custom",
  configFile: false,
  root,
  resolve: { alias: { "@": root } },
  server: { middlewareMode: true, hmr: { port: 24679 } },
});

after(async () => {
  await vite.close();
});

const { affinitySnapshot } = await vite.ssrLoadModule("/data/affinity-snapshot.ts");
const { deriveChainBlock } = await vite.ssrLoadModule("/lib/interpretation/derive-chain-block.ts");

function cloneSnapshot() {
  return structuredClone(affinitySnapshot);
}

function nextSnapshot() {
  const snapshot = cloneSnapshot();
  snapshot.observedAt = "2026-08-30T12:05:00.000Z";
  return snapshot;
}

const previous = { snapshotId: "snapshot-59", snapshot: cloneSnapshot() };

test("quiet verified snapshots preserve the current Chain Block", () => {
  const result = deriveChainBlock(previous, nextSnapshot(), affinitySnapshot.block);

  assert.equal(result.meaningful, false);
  assert.equal(result.block.number, affinitySnapshot.block.number);
  assert.equal(result.provenance.metrics.outcome, "below-materiality-thresholds");
});

test("a five-point declared affinity shift mints a deterministic block", () => {
  const current = nextSnapshot();
  current.edges[0].declaredWeight += 5;
  current.edges[0].strength += 5;

  const first = deriveChainBlock(previous, current, affinitySnapshot.block);
  const second = deriveChainBlock(previous, current, affinitySnapshot.block);

  assert.deepEqual(first, second);
  assert.equal(first.meaningful, true);
  assert.equal(first.kind, "affinity");
  assert.equal(first.block.number, 60);
  assert.equal(first.block.engineVersion, "deterministic-evidence-v2");
  assert.equal(first.block.drivers.length, 1);
});

test("a 25 percent market-cap move crosses the market boundary", () => {
  const current = nextSnapshot();
  current.species[0].marketCapUsd *= 1.25;

  const result = deriveChainBlock(previous, current, affinitySnapshot.block);

  assert.equal(result.meaningful, true);
  assert.equal(result.kind, "market");
  assert.match(result.block.signal, /market cap moved \+25\.0%/);
});

test("a new verified affinity link takes topology priority", () => {
  const current = nextSnapshot();
  current.edges.push({
    ...current.edges[0],
    id: "new-link",
    habitat: "AAPL",
  });
  current.species[0].marketCapUsd *= 2;

  const result = deriveChainBlock(previous, current, affinitySnapshot.block);

  assert.equal(result.meaningful, true);
  assert.equal(result.kind, "topology");
  assert.equal(result.significance, 100);
  assert.deepEqual(result.block.drivers.map((driver) => driver.kind), ["topology", "market"]);
});

test("a gradual move can trigger against the rolling verified baseline", () => {
  const current = nextSnapshot();
  const immediate = cloneSnapshot();
  immediate.observedAt = "2026-08-30T12:00:00.000Z";
  immediate.species[0].marketCapUsd = current.species[0].marketCapUsd;
  const baselineOne = cloneSnapshot();
  baselineOne.observedAt = "2026-08-30T11:05:00.000Z";
  baselineOne.species[0].marketCapUsd = current.species[0].marketCapUsd / 1.2;
  const baselineTwo = cloneSnapshot();
  baselineTwo.observedAt = "2026-08-30T10:05:00.000Z";
  baselineTwo.species[0].marketCapUsd = current.species[0].marketCapUsd / 1.2;

  const result = deriveChainBlock(
    [
      { snapshotId: "snapshot-now", snapshot: immediate },
      { snapshotId: "snapshot-baseline-1", snapshot: baselineOne },
      { snapshotId: "snapshot-baseline-2", snapshot: baselineTwo },
    ],
    current,
    affinitySnapshot.block,
  );

  assert.equal(result.meaningful, true);
  assert.equal(result.kind, "market");
  assert.match(result.block.interpretation, /rolling historical/);
  assert.equal(result.provenance.baselineSnapshotId, "snapshot-baseline-2");
});
