import assert from "node:assert/strict";
import test, { after } from "node:test";
import { fileURLToPath } from "node:url";

import { createServer } from "vite";

const root = fileURLToPath(new URL("..", import.meta.url));
const cloudflareStub = fileURLToPath(new URL("./cloudflare-workers.stub.mjs", import.meta.url));
const vite = await createServer({
  appType: "custom",
  configFile: false,
  root,
  resolve: { alias: { "cloudflare:workers": cloudflareStub } },
  server: { middlewareMode: true, hmr: { port: 24681 } },
});

after(async () => {
  await vite.close();
});

test("renders the default Simple experience with authoritative metadata and security headers", async () => {
  const { default: worker } = await vite.ssrLoadModule("/dist/server/index.js");

  const response = await worker.fetch(
    new Request("http://localhost/app", {
      headers: { accept: "text/html" },
    }),
    {
      ASSETS: {
        fetch: async () => new Response("Not found", { status: 404 }),
      },
    },
    {
      waitUntil() {},
      passThroughOnException() {},
    },
  );

  assert.equal(response.status, 200);
  assert.match(
    response.headers.get("content-type") ?? "",
    /^text\/html\b/i,
  );
  assert.equal(response.headers.get("x-frame-options"), "DENY");
  assert.equal(response.headers.get("x-content-type-options"), "nosniff");
  assert.match(response.headers.get("content-security-policy-report-only") ?? "", /auth\.privy\.io/);
  assert.match(response.headers.get("content-security-policy-report-only") ?? "", /frame-ancestors 'none'/);
  const html = await response.text();
  assert.match(html, /<title>Memetic State — The present, with context<\/title>/i);
  assert.match(html, /Independent attention intelligence for PONS launches/i);
  assert.match(html, /What is moving/);
  assert.match(html, /Market views/);
  assert.match(html, /href="\/app\/observe"/);
  assert.doesNotMatch(html, /codex-preview/i);
});

test("dedicated Observatory, Research and Saved routes render without requiring public wallet access", async () => {
  const { default: worker } = await vite.ssrLoadModule("/dist/server/index.js");
  const environment = { ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) } };
  const context = { waitUntil() {}, passThroughOnException() {} };
  for (const [path, expected] of [["/app/observe", /Full evidence workspace/], ["/app/research", /0\.1% holder access/], ["/app/saved", /Your research memory/], ["/app/token/invalid", /This contract address is invalid/]]) {
    const response = await worker.fetch(new Request(`http://localhost${path}`), environment, context);
    assert.equal(response.status, 200, path);
    assert.match(await response.text(), expected, path);
  }
});

test("the front door renders the landing page, with the existing workspace behind Open app", async () => {
  const { default: worker } = await vite.ssrLoadModule("/dist/server/index.js");
  const response = await worker.fetch(new Request("http://localhost/"),
    { ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) } },
    { waitUntil() {}, passThroughOnException() {} });
  assert.equal(response.status, 200);
  const html = await response.text();
  assert.match(html, /See what’s moving/);
  assert.match(html, /On the radar/);
  assert.match(html, /href="\/app"/);
  assert.match(html, /Public evidence\. No wallet needed to explore/);
  assert.doesNotMatch(html, /Moth Club|Orbit Society|Static Radio/);
  assert.doesNotMatch(html, /Canonical index warming/);
});

test("already-shared token and workspace links retain their parameters", async () => {
  const { default: worker } = await vite.ssrLoadModule("/dist/server/index.js");
  const response = await worker.fetch(new Request("http://localhost/?view=premium&pair=NVDA&window=100000"),
    { ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) } },
    { waitUntil() {}, passThroughOnException() {} });
  assert.equal(response.status, 307);
  assert.equal(response.headers.get("location"), "http://localhost/app/research?pair=NVDA&window=100000");
});
