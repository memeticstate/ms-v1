import assert from "node:assert/strict";
import test, { after } from "node:test";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";

const root = fileURLToPath(new URL("..", import.meta.url));
const vite = await createServer({ appType: "custom", configFile: false, root, resolve: { alias: { "@": root } }, server: { middlewareMode: true, hmr: false } });
after(async () => vite.close());
const { XIngestionClient, XApiError } = await vite.ssrLoadModule("/lib/adapters/x/client.ts");
const { XObservationNormalizer } = await vite.ssrLoadModule("/lib/adapters/x/normalizer.ts");

const payload = {
  data: [{ id: "1234567890", text: "Building on Robinhood Chain.", author_id: "user_999", created_at: "2026-09-12T12:00:00.000Z", public_metrics: { retweet_count: 5, reply_count: 2, like_count: 25, quote_count: 1, impression_count: 1000 } }],
  includes: { users: [{ id: "user_999", name: "Alpha Builder", username: "alphabuilder", created_at: "2025-01-01T00:00:00.000Z", public_metrics: { followers_count: 500, following_count: 150, tweet_count: 1200, listed_count: 10 } }] },
  meta: { result_count: 1, next_token: "token_abc", newest_id: "1234567890", oldest_id: "1234567890" },
};

function response(body = payload, status = 200, headers = {}) {
  return Response.json(body, { status, headers });
}

test("recent search uses the canonical X endpoint, author expansion and durable cursor inputs", async () => {
  let requested = "";
  const client = new XIngestionClient({ bearerToken: "secret", now: () => Date.parse("2026-09-12T12:01:00Z"), fetcher: async url => {
    requested = String(url);
    return response(payload, 200, { "x-rate-limit-limit": "450", "x-rate-limit-remaining": "449", "x-rate-limit-reset": "1789230000" });
  } });
  const result = await client.searchRecent({ query: "($MS OR memeticstate) -is:retweet", sinceId: "100", maxResults: 50 });
  assert.match(requested, /^https:\/\/api\.x\.com\/2\/tweets\/search\/recent\?/);
  assert.match(requested, /since_id=100/);
  assert.match(requested, /expansions=author_id/);
  const observations = XObservationNormalizer.normalizeSearch(result, "($MS OR memeticstate) -is:retweet");
  assert.equal(observations.length, 1);
  assert.equal(observations[0].postId, "1234567890");
  assert.equal(observations[0].author.handle, "alphabuilder");
  assert.equal(observations[0].author.createdAt, "2025-01-01T00:00:00.000Z");
  assert.equal(observations[0].publicMetrics.likeCount, 25);
  assert.equal(observations[0].provenance.nextToken, "token_abc");
  assert.match(observations[0].observationId, /^x:1234567890:/);
});

test("unresolved author expansion stays explicitly unresolved instead of inventing a handle", async () => {
  const client = new XIngestionClient({ bearerToken: "secret", now: () => Date.parse("2026-09-12T12:01:00Z"), fetcher: async () => response({ ...payload, includes: { users: [] } }) });
  const result = await client.searchRecent({ query: "memeticstate" });
  const [observation] = XObservationNormalizer.normalizeSearch(result, "memeticstate");
  assert.equal(observation.author.id, "user_999");
  assert.equal(observation.author.resolved, false);
  assert.equal(observation.author.handle, null);
});

test("401 and other hard 4xx responses fail immediately without retrying", async () => {
  let calls = 0;
  const client = new XIngestionClient({ bearerToken: "bad", maxRetries: 5, sleep: async () => assert.fail("hard 4xx must not sleep"), fetcher: async () => { calls++; return new Response("unauthorized", { status: 401 }); } });
  await assert.rejects(() => client.searchRecent({ query: "memeticstate" }), error => error instanceof XApiError && error.status === 401 && error.retryable === false);
  assert.equal(calls, 1);
});

test("429 exposes reset metadata instead of sleeping past the adapter's runtime budget", async () => {
  let calls = 0, sleeps = 0;
  const now = 1_789_230_000_000;
  const client = new XIngestionClient({ bearerToken: "secret", maxBackoffMs: 30_000, now: () => now, sleep: async () => { sleeps++; }, fetcher: async () => { calls++; return new Response("rate limited", { status: 429, headers: { "x-rate-limit-remaining": "0", "x-rate-limit-reset": String(Math.floor(now / 1000) + 900) } }); } });
  await assert.rejects(() => client.searchRecent({ query: "memeticstate" }), error => error instanceof XApiError && error.status === 429 && error.retryable && error.rateLimits.reset != null);
  assert.equal(calls, 1);
  assert.equal(sleeps, 0);
});

test("transient 5xx responses retry with bounded backoff and then succeed", async () => {
  let calls = 0, sleeps = 0;
  const client = new XIngestionClient({ bearerToken: "secret", maxRetries: 2, random: () => 0, sleep: async ms => { sleeps++; assert.ok(ms <= 30_000); }, fetcher: async () => ++calls === 1 ? new Response("oops", { status: 503 }) : response() });
  const result = await client.searchRecent({ query: "memeticstate" });
  assert.equal(result.response.data.length, 1);
  assert.equal(calls, 2);
  assert.equal(sleeps, 1);
});

test("invalid maxResults and malformed successful payloads fail closed", async () => {
  const client = new XIngestionClient({ bearerToken: "secret", fetcher: async () => response({ data: [{ id: "bad" }] }) });
  await assert.rejects(() => client.searchRecent({ query: "memeticstate", maxResults: 1 }), /10 through 100/);
  await assert.rejects(() => client.searchRecent({ query: "memeticstate" }));
});
