import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test, { after } from "node:test";
import { fileURLToPath } from "node:url";

import { privateKeyToAccount } from "viem/accounts";
import { verifyMessage } from "viem";
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

test("the Field plan creates useful capacity without gating public truth", async () => {
  const { capabilityIsPublic, resolveEntitlementProfile } = await vite.ssrLoadModule("/lib/entitlements/model.ts");
  const profile = resolveEntitlementProfile([]);
  assert.equal(profile.plan, "field");
  assert.equal(profile.allowances.server_watch_slots, 5);
  assert.equal(profile.allowances.alert_routes, 0);
  assert.equal(capabilityIsPublic("canonical_events"), true);
  assert.equal(capabilityIsPublic("rankings"), true);
  assert.equal(capabilityIsPublic("server_watch_slots"), false);
});

test("active grants choose explicit capacity ceilings and subtract usage", async () => {
  const { resolveEntitlementProfile } = await vite.ssrLoadModule("/lib/entitlements/model.ts");
  const now = 2_000_000_000;
  const profile = resolveEntitlementProfile([
    { id: "founder", source: "founding", plan: "founding", status: "active", startsAt: now - 10, endsAt: null, allowances: {} },
    { id: "expired", source: "paid", plan: "team", status: "active", startsAt: now - 100, endsAt: now - 1, allowances: {} },
    { id: "override", source: "admin", plan: "field", status: "active", startsAt: now - 10, endsAt: null, allowances: { server_watch_slots: 75 } },
  ], { server_watch_slots: 12, reports_monthly: 3 }, now);
  assert.equal(profile.plan, "founding");
  assert.equal(profile.allowances.server_watch_slots, 75);
  assert.equal(profile.remaining.server_watch_slots, 63);
  assert.equal(profile.remaining.reports_monthly, 5);
  assert.equal(profile.sources.some((source) => source.id === "expired"), false);
});

test("token holder access stays disabled until configured and uses exact supply math", async () => {
  const { tokenAdapterStatus, qualifiesForPremium, readTokenGateOnchain } = await vite.ssrLoadModule("/lib/entitlements/token-adapter.ts");
  const disabled = tokenAdapterStatus();
  assert.equal(disabled.state, "disabled");
  assert.equal(disabled.grantingEnabled, false);
  const missingContract = tokenAdapterStatus({ MEMETIC_TOKEN_ENTITLEMENTS_ENABLED: "true" });
  assert.equal(missingContract.state, "configuration_required");
  assert.equal(missingContract.grantingEnabled, false);

  const readyBindings = {
    MEMETIC_TOKEN_ENTITLEMENTS_ENABLED: "true",
    MEMETIC_TOKEN_CONTRACT_ADDRESS: "0x0000000000000000000000000000000000000001",
  };
  const ready = tokenAdapterStatus(readyBindings);
  assert.equal(ready.state, "ready");
  assert.equal(ready.grantingEnabled, true);
  assert.equal(ready.thresholdBps, 5);
  assert.equal(qualifiesForPremium(500n, 1_000_000n), true);
  assert.equal(qualifiesForPremium(499n, 1_000_000n), false);
  assert.equal(qualifiesForPremium(123456789012345678901234567890n, 123456789012345678901234567890n), true);

  const result = await readTokenGateOnchain({
    walletAddress: "0x0000000000000000000000000000000000000002",
    bindings: readyBindings,
    fetcher: async (_url, init) => {
      const requests = JSON.parse(init.body);
      assert.equal(requests.length, 4);
      return new Response(JSON.stringify([
        { jsonrpc: "2.0", id: 1, result: "0x1237" },
        { jsonrpc: "2.0", id: 2, result: "0x100" },
        { jsonrpc: "2.0", id: 3, result: "0xf4240" },
        { jsonrpc: "2.0", id: 4, result: "0x1f4" },
      ]), { status: 200, headers: { "content-type": "application/json" } });
    },
  });
  assert.equal(result.eligible, true);
  assert.equal(result.balanceRaw, "500");
  assert.equal(result.totalSupplyRaw, "1000000");
  assert.equal(result.providerCount, 4);
});

test("wallet proof binds account, chain, origin and expiry without a transaction", async () => {
  const { buildWalletLinkMessage } = await vite.ssrLoadModule("/lib/entitlements/wallet-message.ts");
  const account = privateKeyToAccount("0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80");
  const message = buildWalletLinkMessage({
    accountId: "account-123",
    walletAddress: account.address,
    challengeId: "challenge-123",
    origin: "https://memetic-state.z3c4.chatgpt.site",
    issuedAt: 2_000_000_000,
    expiresAt: 2_000_000_300,
  });
  const signature = await account.signMessage({ message });
  assert.equal(await verifyMessage({ address: account.address, message, signature }), true);
  assert.match(message, /Chain ID: 4663/);
  assert.match(message, /does not submit a transaction or spend funds/);
  assert.match(message, /challenge-123/);
});

test("entitlement storage is migrated and public evidence routes stay outside the gate", async () => {
  const migration = await readFile(path.join(root, "drizzle/0010_purple_magneto.sql"), "utf8");
  const gateMigration = await readFile(path.join(root, "drizzle/0011_token_gate_checks.sql"), "utf8");
  const publicRoute = await readFile(path.join(root, "app/api/pons-state/route.ts"), "utf8");
  const accountRoute = await readFile(path.join(root, "app/api/entitlements/me/route.ts"), "utf8");
  assert.match(migration, /CREATE TABLE `entitlement_grants`/);
  assert.match(migration, /CREATE TABLE `entitlement_usage`/);
  assert.match(migration, /CREATE TABLE `linked_wallets`/);
  assert.match(migration, /CREATE TABLE `watchtower_watches`/);
  assert.match(gateMigration, /CREATE TABLE `token_gate_checks`/);
  assert.match(gateMigration, /token_gate_checks_wallet_contract_idx/);
  assert.match(gateMigration, /token_gate_checks_expiry_idx/);
  assert.doesNotMatch(publicRoute, /getChatGPTUser|requireChatGPTUser|entitlement/);
  assert.match(accountRoute, /getChatGPTUser/);
  assert.match(accountRoute, /cache-control.*no-store/s);
});

test("premium interpretation is server-gated and state mutations require same-origin requests", async () => {
  const [premiumRoute, refreshRoute, security, partnerRoute, watchRoute] = await Promise.all([
    readFile(path.join(root, "app/api/premium/interpretation/route.ts"), "utf8"),
    readFile(path.join(root, "app/api/entitlements/refresh/route.ts"), "utf8"),
    readFile(path.join(root, "lib/entitlements/request-security.ts"), "utf8"),
    readFile(path.join(root, "app/api/research-partner/route.ts"), "utf8"),
    readFile(path.join(root, "app/api/watchtower/watches/route.ts"), "utf8"),
  ]);
  assert.match(premiumRoute, /getChatGPTUser/);
  assert.match(premiumRoute, /premium_access_required/);
  assert.match(premiumRoute, /derivePremiumInterpretation/);
  assert.match(refreshRoute, /rejectCrossSiteMutation/);
  assert.match(refreshRoute, /recentCheck/);
  assert.match(refreshRoute, /force: !recentCheck/);
  assert.match(security, /same_origin_required/);
  assert.match(partnerRoute, /rejectCrossSiteMutation/);
  assert.match(watchRoute, /rejectCrossSiteMutation/);
});

test("public network copy keeps operator launch planning out of the observatory", async () => {
  const network = await readFile(path.join(root, "components/pons-observatory.tsx"), "utf8");
  assert.match(network, /PremiumInterpretationPanel/);
  assert.doesNotMatch(network, /30-day launch loop|How it sells|Supporter utility|The whale answer|tokenFlywheel|launchLoop/);
});
