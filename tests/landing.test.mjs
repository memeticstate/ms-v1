import assert from "node:assert/strict";
import test, { after } from "node:test";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";

const root = fileURLToPath(new URL("..", import.meta.url));
const vite = await createServer({ appType: "custom", configFile: false, root,
  resolve: { alias: { "@": root } }, server: { middlewareMode: true, hmr: false } });
after(() => vite.close());
const { landingSignal, landingSignals, legacyAppHref, tokenAppHref } = await vite.ssrLoadModule("/lib/pons/landing.ts");
const { assessLaunch } = await vite.ssrLoadModule("/lib/pons/research.ts");
const now = Date.parse("2026-09-10T00:00:00Z");
const timestamp = new Date(now - 30_000).toISOString();
const launch = { tokenAddress: `0x${"a".repeat(40)}`, symbol: "EXAMPLE", name: "Example", blockNumber: 100,
  phase: "bonding", recentTrades: 40, previousTrades: 20, recentUniqueTraders: 15,
  previousUniqueTraders: 10, recentBuys: 30, recentSells: 10, netQuoteFlow: 100,
  attentionScore: 25, lastTradeAt: timestamp, currentEvidence: {
    observedAt: timestamp, meaningfulHolders: 12, largestWalletSharePercent: 2,
    reserveSharePercent: 50, holdersComplete: false, holderSampleSize: 24,
  } };
const state = { mode: "live", generatedAt: timestamp, collector: { status: "succeeded" },
  integrity: { pulseReconciled: true }, index: { consecutiveFailures: 0, liveLagBlocks: 10, lastSuccessAt: timestamp },
  launches: [launch] };

test("landing summaries translate the same policy and never mutate app data", () => {
  const before = JSON.stringify(state);
  const item = landingSignal(launch, state, now);
  const research = assessLaunch(launch, true, now);
  assert.equal(item.signal, research.signal);
  assert.equal(item.eligible, research.eligible);
  assert.equal(item.label, "Growing");
  assert.match(item.support, /15 trading wallets/);
  assert.match(item.uncertainty, /not a prediction/);
  assert.equal(JSON.stringify(state), before);
});

test("delayed and expired data never keeps a positive landing badge", () => {
  const delayed = { ...state, index: { ...state.index, liveLagBlocks: 3_600_000 } };
  for (const item of [landingSignal(launch, delayed, now), landingSignal(launch, state, now + 121_000)]) {
    assert.equal(item.signal, "historical");
    assert.equal(item.label, "Past activity");
    assert.equal(item.tone, "neutral");
    assert.equal(item.eligible, false);
  }
});

test("missing holders, post-curve activity and depleted holders retain their exclusions", () => {
  for (const changes of [{ currentEvidence: null }, { phase: "graduated" }, { previousTrades: 0 }]) {
    const item = landingSignal({ ...launch, ...changes }, state, now);
    assert.equal(item.label, "Needs checking");
    assert.equal(item.eligible, false);
  }
  const item = landingSignal({ ...launch, currentEvidence: { ...launch.currentEvidence, reserveSharePercent: 99.9 } }, state, now);
  assert.equal(item.signal, "inactive");
  assert.equal(item.eligible, false);
  assert.match(item.summary, /depleted/);
});

test("stress stays visible without a discovery recommendation", () => {
  const item = landingSignal({ ...launch, netQuoteFlow: -100, recentSells: 35, recentBuys: 5 }, state, now);
  assert.equal(item.label, "Under pressure");
  assert.equal(item.eligible, false);
  assert.equal(item.tone, "negative");
});

test("preview stays bounded, searches actual records and never invents matches", () => {
  const launches = Array.from({ length: 8 }, (_, index) => ({ ...launch, symbol: `EX${index}`, name: `Example ${index}`, blockNumber: index + 100, tokenAddress: `0x${String(index).repeat(40)}` }));
  const full = { ...state, launches };
  assert.equal(landingSignals(full, "launches", "", now).length, 5);
  assert.equal(landingSignals(full, "launches", "", now)[0].launch.blockNumber, 107);
  assert.equal(landingSignals(full, "changes", "$ex2", now)[0].launch.symbol, "EX2");
  assert.equal(landingSignals(full, "changes", "no-such-token", now).length, 0);
  assert.equal(landingSignals({ ...state, launches: [] }, "changes", "", now).length, 0);
});

test("deep links are local, encoded, and keep the exact requested token", () => {
  assert.equal(tokenAppHref(launch.tokenAddress), `/app?view=signals&token=${launch.tokenAddress}&inspect=1`);
  assert.equal(tokenAppHref("https://example.com"), "/app");
  assert.equal(legacyAppHref({ view: "atlas", token: launch.tokenAddress, pair: "NVDA", window: "100000" }), `/app?view=atlas&token=${launch.tokenAddress}&pair=NVDA&window=100000`);
  assert.equal(legacyAppHref({ utm_source: "twitter" }), null);
  assert.equal(legacyAppHref({}), null);
});
