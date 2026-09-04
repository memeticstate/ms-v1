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
  server: { middlewareMode: true, hmr: { port: 24680 } },
});

after(async () => {
  await vite.close();
});

const { normalizePairToken } = await vite.ssrLoadModule("/lib/adapters/pair.ts");

test("derives dossier metrics from observed market and affinity inputs", () => {
  const result = normalizePairToken({
    address: "0x0000000000000000000000000000000000000001",
    symbol: "TEST",
    name: "Test Species",
    marketCapUsd: 100_000,
    volumeUsd: 50_000,
    liquidityUsd: 12_000,
    totalDepthUsd: 25_000,
    priceUsd: 0.01,
    trades24h: 1_000,
    priceChange24h: 12,
    graduated: true,
    marketDataUpdatedAt: "2026-08-30T12:00:00.000Z",
    launchTxHash: `0x${"1".repeat(64)}`,
    markets: [
      { symbol: "NVDA", weightBps: 5_000 },
      { symbol: "AMD", weightBps: 5_000 },
    ],
  }, {
    id: "test",
    color: "#ffffff",
    x: 100,
    y: 100,
  });

  assert.equal(result.species.metrics.version, "observed-v1");
  assert.equal(result.species.metrics.affinityBalance, 100);
  assert.equal(result.species.metrics.turnover24h, 50);
  assert.equal(result.species.metrics.depthRatio, 25);
  assert.equal(result.species.metrics.dataCompleteness, 100);
  assert.match(result.species.interpretation, /Observed 24h turnover is 50\.0%/);
});
