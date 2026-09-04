import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test, { after } from "node:test";
import { fileURLToPath } from "node:url";

import { createServer } from "vite";

const root = fileURLToPath(new URL("..", import.meta.url));
const vite = await createServer({
  appType: "custom",
  configFile: false,
  root,
  resolve: { alias: { "@": root } },
  server: { middlewareMode: true },
});

after(async () => {
  await vite.close();
});

const launch = {
  tokenAddress: "0x0000000000000000000000000000000000000001",
  curveAddress: "0x0000000000000000000000000000000000000002",
  deployerAddress: "0x0000000000000000000000000000000000000003",
  pairTokenAddress: "0x0000000000000000000000000000000000000004",
  pairSymbol: "NVDA",
  pairColor: "#82965d",
  name: "Signal Species",
  symbol: "SIG",
  blockNumber: 100,
  launchedAt: "2026-08-31T00:00:00.000Z",
  txHash: "0xabc",
  launchConfigId: 1,
  graduationThresholdRaw: "1000",
  phase: "bonding",
  trades: 10,
  buys: 7,
  sells: 3,
  uniqueTraders: 5,
  recentTrades: 9,
  previousTrades: 5,
  recentUniqueTraders: 4,
  recentBuys: 6,
  recentSells: 3,
  momentumPercent: 20,
  buyShare: 67,
  signal: "steady",
  signalNote: "Activity held.",
  confidence: "medium",
  flowQuality: 60,
  attentionScore: 55,
  deployerLaunches: 2,
  deployerGraduations: 0,
};

test("watchlist emits one alert per newly crossed research rule", async () => {
  const { createWatchEntry, reconcileWatchEntry } = await vite.ssrLoadModule("/lib/pons/watchlist.ts");
  const saved = createWatchEntry(launch, "2026-08-31T00:00:00.000Z");
  const changed = {
    ...launch,
    signal: "surging",
    phase: "graduated",
    recentTrades: 30,
    momentumPercent: 80,
  };
  const first = reconcileWatchEntry(saved, changed, "2026-08-31T00:05:00.000Z");
  assert.equal(first.newAlerts, 4);
  assert.deepEqual(first.entry.alerts.map((item) => item.kind).sort(), ["activity", "lifecycle", "momentum", "signal"]);

  const repeated = reconcileWatchEntry(first.entry, changed, "2026-08-31T00:06:00.000Z");
  assert.equal(repeated.newAlerts, 0);
  assert.equal(repeated.entry.alerts.length, 4);
});

test("watchlist parser rejects corrupt local state", async () => {
  const { parseWatchlist } = await vite.ssrLoadModule("/lib/pons/watchlist.ts");
  assert.deepEqual(parseWatchlist("not-json"), []);
  assert.deepEqual(parseWatchlist(JSON.stringify({ tokenAddress: "0x1" })), []);
});

test("launch plan is condensed around one 30-day operating loop", async () => {
  const plan = await readFile(path.join(root, "docs/launch/gtm.md"), "utf8");
  assert.match(plan, /The 30-day loop/);
  assert.match(plan, /Observe:[\s\S]*Return:[\s\S]*Learn:[\s\S]*Convert:/);
  assert.match(plan, /PONS remains the intelligence universe/);
  assert.match(plan, /NVDA remains the focused flagship habitat/);
});

test("Pulse visual export is X-ready and evidence labeled", async () => {
  const source = await readFile(path.join(root, "lib/pons/pulse-card.ts"), "utf8");
  assert.match(source, /const WIDTH = 1600/);
  assert.match(source, /const HEIGHT = 900/);
  assert.match(source, /COHORT TOTALS RECONCILED/);
  assert.match(source, /OBSERVED ACTIVITY—NOT ASSET QUALITY/);
});

test("Field Archive branding ships a real day and night atlas", async () => {
  const css = await readFile(path.join(root, "app/globals.css"), "utf8");
  const layout = await readFile(path.join(root, "app/layout.tsx"), "utf8");
  const observatory = await readFile(path.join(root, "components/pons-observatory.tsx"), "utf8");
  assert.match(css, /--lichen-green: #a4b579/);
  assert.match(css, /\.light \{[\s\S]*--background: #e8e1d2/);
  assert.doesNotMatch(css, /#00ffcc|#8a2be2/i);
  assert.match(layout, /<ThemeProvider>/);
  assert.match(observatory, /Use \$\{resolvedTheme === "light" \? "dark" : "light"\} atlas/);
});
