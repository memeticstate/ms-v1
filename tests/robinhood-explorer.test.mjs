import assert from "node:assert/strict";
import test, { after } from "node:test";
import { readFile, readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";

const root = fileURLToPath(new URL("..", import.meta.url));
const vite = await createServer({ appType: "custom", configFile: false, root, resolve: { alias: { "@": root } }, server: { middlewareMode: true, hmr: false } });
after(() => vite.close());
const { ROBINHOOD_EXPLORER, robinhoodExplorer, canonicalRobinhoodExplorerUrl } = await vite.ssrLoadModule("/lib/robinhood-explorer.ts");
const { MEMETIC_TOKEN_ADDRESS, MEMETIC_TOKEN_EXPLORER_URL } = await vite.ssrLoadModule("/lib/memetic-token.ts");
const { marketSource, holderSource, unavailableSource } = await vite.ssrLoadModule("/lib/researcher/sources.ts");
const token = "0x" + "a".repeat(40);
const transaction = "0x" + "b".repeat(64);
const legacy = "https://robinhoodchain.blockscout.com";

test("public Robinhood address, token, transaction and block destinations share the canonical explorer", () => {
  assert.equal(ROBINHOOD_EXPLORER, "https://robin.etherscan.io");
  assert.equal(robinhoodExplorer.address(token), `${ROBINHOOD_EXPLORER}/address/${token}`);
  assert.equal(robinhoodExplorer.token(token), `${ROBINHOOD_EXPLORER}/token/${token}`);
  assert.equal(robinhoodExplorer.tx(transaction), `${ROBINHOOD_EXPLORER}/tx/${transaction}`);
  assert.equal(robinhoodExplorer.block(12345), `${ROBINHOOD_EXPLORER}/block/12345`);
  assert.equal(robinhoodExplorer.block("12345"), robinhoodExplorer.block(12345));
  assert.equal(MEMETIC_TOKEN_EXPLORER_URL, robinhoodExplorer.address(MEMETIC_TOKEN_ADDRESS));
  assert.equal(new URL(robinhoodExplorer.address(`${token}?redirect=other`)).search, "");
});

test("saved evidence links migrate at display time, including the holder view", () => {
  for (const [kind, value] of [["address", token], ["token", token], ["tx", transaction], ["block", "12345"]]) {
    assert.equal(canonicalRobinhoodExplorerUrl(`${legacy}/${kind}/${value}`), robinhoodExplorer[kind](value));
  }
  assert.equal(canonicalRobinhoodExplorerUrl(`${legacy}/token/${token}?tab=holders`), `${robinhoodExplorer.token(token)}#balances`);
  assert.equal(canonicalRobinhoodExplorerUrl(`${legacy}/address/${token}?a=1#code`), `${robinhoodExplorer.address(token)}?a=1#code`);
});

test("explorer migration preserves Blockscout APIs, canonical RPCs and unrelated source URLs", () => {
  const sources = [
    `${legacy}/api?module=account&action=tokenbalance&address=${token}`,
    `${legacy}/api/v2/tokens/${token}/holders`,
    "https://rpc.mainnet.chain.robinhood.com",
    "https://robinhood-rpc.publicnode.com",
    "https://api.robinhood.com/rhj/assets",
    `https://www.ponsfamily.com/launchpad/${token}`,
    `https://robinhoodchain.blockscout.com.example.org/address/${token}`,
    robinhoodExplorer.token(token),
    "not a URL",
  ];
  for (const source of sources) assert.equal(canonicalRobinhoodExplorerUrl(source), source);
});

test("research source links change without changing recorded evidence time or using an explorer API", () => {
  const observedAt = "2026-09-10T12:00:00Z";
  const now = Date.parse(observedAt);
  const market = marketSource(token, { tokenAddress: token, source: "contract", sourceFetchedAt: observedAt, name: "Example", symbol: "EX" }, now);
  assert.equal(market.url, robinhoodExplorer.address(token));
  assert.equal(market.evidenceAt, observedAt);
  assert.equal(unavailableSource("index", token, "Not indexed", now).url, robinhoodExplorer.address(token));
  const holder = holderSource(token, { holderEvidence: { observedAt, holderSampleSize: 3, holdersComplete: false } }, now);
  assert.equal(holder.url, `${robinhoodExplorer.token(token)}#balances`);
  assert.equal(holder.evidenceAt, observedAt);
});

test("application links cannot silently reintroduce a hard-coded legacy explorer", async () => {
  async function inspect(directory) {
    for (const entry of await readdir(`${root}/${directory}`, { withFileTypes: true })) {
      const file = `${directory}/${entry.name}`;
      if (entry.isDirectory()) await inspect(file);
      else if (/\.[cm]?[jt]sx?$/.test(entry.name) && file !== "lib/robinhood-explorer.ts") {
        const source = await readFile(`${root}/${file}`, "utf8");
        assert.doesNotMatch(source, /https?:\/\/(?:robinhoodchain\.blockscout\.com|explorer\.mainnet\.chain\.robinhood\.com)(?:\/|["'`])/, file);
        assert.doesNotMatch(source, /https:\/\/robin\.etherscan\.io/, `${file} must use the shared helper`);
      }
    }
  }
  for (const directory of ["app", "components", "lib", "db"]) await inspect(directory);
  const wallet = await readFile(`${root}/components/memetic-auth-provider.tsx`, "utf8");
  assert.match(wallet, /url: ROBINHOOD_EXPLORER/);
});
