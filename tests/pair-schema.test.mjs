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
  server: { middlewareMode: true, hmr: { port: 24682 } },
});

after(async () => {
  await vite.close();
});

const { parsePairDiscoveryPayload } = await vite.ssrLoadModule("/lib/ingestion/pair-cohort.ts");

test("discovery accepts nullable market rows and empty pools so eligibility can exclude them", () => {
  const payload = parsePairDiscoveryPayload({
    items: [{
      address: "0x0000000000000000000000000000000000000001",
      name: "Unobserved species",
      symbol: "NULL",
      pairs: [],
      totalDepthUsd: null,
      activeVirtualSwapDepthUsd: null,
      marketCapUsd: "1000",
      volume24hUsd: null,
      priceUsd: null,
      change24hPct: null,
      graduated: false,
      hidden: false,
      flagged: false,
      marketDataSource: null,
      marketDataUpdatedAt: null,
      launchTxHash: `0x${"1".repeat(64)}`,
      launchedAt: 1_788_000_000,
      creator: "0x0000000000000000000000000000000000000003",
    }],
    total: 1,
    page: 1,
    limit: 50,
  });

  assert.equal(payload.items.length, 1);
  assert.equal(payload.items[0].pairs.length, 0);
  assert.equal(payload.items[0].volume24hUsd, null);
  assert.equal(payload.items[0].marketDataUpdatedAt, null);
});
