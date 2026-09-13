import assert from "node:assert/strict";
import test, { after } from "node:test";
import { createServer } from "vite";
import { fileURLToPath } from "node:url";
const root = fileURLToPath(new URL("..", import.meta.url));
const vite = await createServer({ appType: "custom", configFile: false, root,
  resolve: { alias: { "@": root } }, server: { middlewareMode: true, hmr: false } });
after(() => vite.close());
const { withRequestContext, requestCache } = await vite.ssrLoadModule("/lib/request-context.ts");
const { getPonsHead, getPonsBlocks } = await vite.ssrLoadModule("/lib/ingestion/pons-rpc.ts");

test("a new Worker invocation cannot inherit a canceled invocation's pending work", async () => {
  let release;
  const old = withRequestContext(async () => {
    const cache = requestCache("discovery", () => new Map());
    cache.set("pending", new Promise(resolve => { release = resolve; }));
    await cache.get("pending");
    assert.equal(requestCache("discovery", () => new Map()), cache);
  });
  await withRequestContext(async () => {
    const cache = requestCache("discovery", () => new Map());
    assert.equal(cache.has("pending"), false);
    await Promise.resolve();
    assert.equal(requestCache("discovery", () => new Map()), cache);
  });
  release();
  await old;
});

test("an expired collection deadline starts no upstream requests", async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async () => { assert.fail("deadline already exhausted"); };
  try {
    await assert.rejects(getPonsHead(Date.now() - 1), /deadline_exhausted/);
    await assert.rejects(getPonsBlocks([1], Date.now() - 1), /budget_exhausted/);
  } finally { globalThis.fetch = original; }
});

test("event timestamps resolve in bounded batches with exact block identity", async () => {
  const original = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async (_url, options) => {
    calls++;
    const requests = JSON.parse(options.body);
    const block = request => ({ id: request.id, result: { number: request.params[0], hash: `0x${"1".repeat(64)}`, timestamp: "0x64" } });
    return Response.json(Array.isArray(requests) ? requests.map(block) : block(requests));
  };
  try {
    const blocks = await withRequestContext(() => getPonsBlocks([1, 2, 2, 3, 4], Date.now() + 5000));
    assert.equal(calls, 1);
    assert.deepEqual(blocks.map(block => block.number), [1, 2, 3, 4]);
    assert.ok(blocks.every(block => block.timestamp === 100));
  } finally { globalThis.fetch = original; }
});
