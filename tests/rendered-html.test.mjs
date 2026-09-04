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

test("renders authoritative PONS Observatory metadata", async () => {
  const { default: worker } = await vite.ssrLoadModule("/dist/server/index.js");

  const response = await worker.fetch(
    new Request("http://localhost/", {
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
  const html = await response.text();
  assert.match(html, /<title>Memetic State — PONS Observatory<\/title>/i);
  assert.match(html, /Independent attention intelligence for PONS launches/i);
  assert.doesNotMatch(html, /codex-preview/i);
});
