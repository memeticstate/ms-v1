import assert from "node:assert/strict";
import test, { after } from "node:test";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";

const root = fileURLToPath(new URL("..", import.meta.url));
const vite = await createServer({ appType: "custom", configFile: false, root,
  resolve: { alias: { "@": root } }, server: { middlewareMode: true, hmr: false } });
after(() => vite.close());
const { OBSERVATORY_VIEWS, parseObservatoryLocation, appTokenHref, legacyAppDestination } = await vite.ssrLoadModule("/lib/app-navigation.ts");
const token = `0x${"AB".repeat(20)}`;

test("an Observatory token deep link opens its evidence without requiring inspect=1", () => {
  const route = parseObservatoryLocation(`?token=${token}&view=atlas&pair=nvda&window=25000`);
  assert.equal(route.token, token.toLowerCase());
  assert.equal(route.openDossier, true);
  assert.equal(route.view, "atlas");
  assert.equal(route.pair, "NVDA");
  assert.equal(route.windowBlocks, 25000);
});

test("the dedicated research route carries the token into research without opening an Observatory modal", () => {
  const route = parseObservatoryLocation(`?token=${token}&view=signals&inspect=1`, "research");
  assert.equal(route.token, token.toLowerCase());
  assert.equal(route.view, "premium");
  assert.equal(route.openDossier, false);
  assert.equal(parseObservatoryLocation("?view=premium", "saved").view, "watchlist");
});

test("every existing Observatory workspace remains addressable", () => {
  assert.equal(OBSERVATORY_VIEWS.length, 8);
  for (const view of ["signals", "atlas", "watchlist", "tape", "history", "evidence", "network", "premium"]) {
    assert.equal(parseObservatoryLocation(`?view=${view}`).view, view);
  }
});

test("invalid token and workspace inputs do not open an unrelated token", () => {
  const route = parseObservatoryLocation("?token=https://example.test&inspect=1&view=unknown&window=-1");
  assert.equal(route.token, null);
  assert.equal(route.openDossier, false);
  assert.equal(route.view, "signals");
  assert.equal(route.windowBlocks, parseObservatoryLocation("").windowBlocks);
});

test("token actions preserve one validated identity across the brief, Observe and Research", () => {
  assert.equal(appTokenHref("brief", token), `/app/token/${token.toLowerCase()}`);
  for (const destination of ["observe", "research"]) {
    const url = new URL(appTokenHref(destination, token), "https://memeticstate.test");
    assert.equal(url.pathname, `/app/${destination}`);
    assert.equal(parseObservatoryLocation(url.search, destination).token, token.toLowerCase());
  }
  assert.equal(appTokenHref("research", "javascript:alert(1)"), "/app/research");
  assert.equal(appTokenHref("brief", "missing"), "/app");
});

test("legacy app views move to their dedicated routes while retaining token and evidence context", () => {
  for (const [view, path] of [["premium", "/app/research"], ["watchlist", "/app/saved"], ["atlas", "/app/observe"], ["evidence", "/app/observe"], ["network", "/app/observe"]]) {
    const destination = new URL(legacyAppDestination(`?view=${view}&token=${token}&window=100000&pair=NVDA&inspect=1`), "https://memeticstate.test");
    assert.equal(destination.pathname, path);
    assert.equal(destination.searchParams.get("token"), token.toLowerCase());
    assert.equal(destination.searchParams.get("window"), "100000");
    assert.equal(destination.searchParams.get("pair"), "NVDA");
    assert.equal(destination.searchParams.get("view"), path === "/app/observe" ? view : null);
  }
});

test("a legacy token-only link opens that Token Brief and preserves other link context", () => {
  const destination = new URL(legacyAppDestination(`?token=${token}&pair=GLD&window=25000&utm_source=x`), "https://memeticstate.test");
  assert.equal(destination.pathname, `/app/token/${token.toLowerCase()}`);
  assert.equal(destination.searchParams.get("token"), null);
  assert.equal(destination.searchParams.get("pair"), "GLD");
  assert.equal(destination.searchParams.get("window"), "25000");
  assert.equal(destination.searchParams.get("utm_source"), "x");
});

test("default Simple navigation and explicit modes are never redirected", () => {
  for (const search of ["", "?utm_source=x", "?view=unknown", "?token=invalid", "?mode=changes", `?mode=changes&token=${token}`, "?mode=now&view=evidence"]) {
    assert.equal(legacyAppDestination(search), null, search);
  }
  assert.equal(legacyAppDestination("?pair=GLD&window=25000"), "/app/observe?pair=GLD&window=25000");
});

test("Saved shows recorded deterioration for a watch outside the current ranked results", async () => {
  const { createElement } = await import("react");
  const { renderToStaticMarkup } = await import("react-dom/server");
  const { WatchlistPanel } = await vite.ssrLoadModule("/components/watchlist-panel.tsx");
  const address = token.toLowerCase();
  const entry = { tokenAddress: address, name: "Watched token", symbol: "WATCH", pairSymbol: "NVDA", pairColor: "#82965d",
    savedAt: "2026-09-14T00:00:00Z", updatedAt: "2026-09-14T00:00:00Z", alerts: [],
    lastSeen: { signal: "steady", phase: "bonding", recentTrades: 20, momentumPercent: 2, attentionScore: 30 },
    rules: { signalChange: true, lifecycleChange: true, activityThreshold: null, momentumThreshold: null } };
  const transition = { observedAt: "2026-09-14T01:00:00Z", previousObservedAt: "2026-09-14T00:00:00Z", from: "steady", to: "stressed",
    kind: "deteriorated", label: "Participation deteriorated", whatChanged: ["Retained participation declined."], watchNext: "Check another recorded window.", changeKinds: ["signal"] };
  const html = renderToStaticMarkup(createElement(WatchlistPanel, { entries: [entry], launches: [], transitions: { [address]: transition },
    onInspect() {}, onRulesChange() {}, onRemove() {}, onReadAll() {} }));
  assert.match(html, /Participation deteriorated/);
  assert.match(html, /Retained participation declined/);
  assert.match(html, /steady → stressed/);
  assert.match(html, new RegExp(`/app/token/${address}`));
  assert.match(html, /No rule crossings observed/);
  assert.equal(entry.alerts.length, 0, "displaying memory must not synthesize an alert");
});
