import assert from 'node:assert/strict';
import test, { after } from 'node:test';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
const root = fileURLToPath(new URL('..', import.meta.url));
const vite = await createServer({ appType: 'custom', configFile: false, root, resolve: { alias: { '@': root } }, server: { middlewareMode: true, hmr: false } });
after(() => vite.close());
const { createTokenIconResolver } = await vite.ssrLoadModule('/lib/tokens/icon-client.ts');
const address = n => '0x' + n.toString(16).padStart(40, '0');
const icon = 'https://www.ponsfamily.com/api/ipfs/content/bafyTest?variant=card';

test('artwork recovery deduplicates contracts, bounds concurrency and reuses cached results', async () => {
  let active = 0, peak = 0, calls = 0;
  const resolver = createTokenIconResolver(async url => {
    calls++; active++; peak = Math.max(peak, active);
    await new Promise(resolve => setTimeout(resolve, 2)); active--;
    return Response.json({ token: { tokenAddress: new URL(url, 'https://example.test').searchParams.get('token'), imageUrl: icon } });
  });
  const first = resolver(address(1)), duplicate = resolver(address(1).toUpperCase().replace('0X', '0x'));
  assert.equal(first, duplicate);
  assert.deepEqual(await Promise.all([first, duplicate, ...Array.from({length: 8}, (_, i) => resolver(address(i + 2)))]), Array(10).fill(icon));
  assert.equal(peak, 3); assert.equal(calls, 9);
  assert.equal(await resolver(address(1)), icon); assert.equal(calls, 9);
});

test('artwork recovery rejects wrong-contract metadata, unsafe media and invalid addresses', async () => {
  let calls = 0;
  const resolver = createTokenIconResolver(async () => {
    calls++;
    return Response.json({ token: { tokenAddress: address(2), imageUrl: calls === 1 ? icon : 'https://127.0.0.1/private' } });
  });
  assert.equal(await resolver('bad-address'), null); assert.equal(calls, 0);
  assert.equal(await resolver(address(1)), null);
  assert.equal(await resolver(address(2)), null);
});

test('unavailable artwork is briefly cached and can recover on a later request', async () => {
  let time = 0, calls = 0;
  const resolver = createTokenIconResolver(async () => {
    if (++calls === 1) throw new Error('unavailable');
    return Response.json({ token: { tokenAddress: address(1), imageUrl: icon } });
  }, () => time);
  assert.equal(await resolver(address(1)), null);
  assert.equal(await resolver(address(1)), null); assert.equal(calls, 1);
  time = 60_001;
  assert.equal(await resolver(address(1)), icon); assert.equal(calls, 2);
});

test('valid token artwork renders through the existing safe image proxy', async () => {
  const { TokenAvatar } = await vite.ssrLoadModule('/components/token-avatar.tsx');
  const { createElement } = await import('react');
  const { renderToStaticMarkup } = await import('react-dom/server');
  const html = renderToStaticMarkup(createElement(TokenAvatar, { token: { tokenAddress: address(1), name: 'Example', symbol: 'EX', imageUrl: icon } }));
  assert.ok(html.includes('/api/token-image?src=' + encodeURIComponent(icon)));
  const fallback = renderToStaticMarkup(createElement(TokenAvatar, { token: { tokenAddress: address(1), name: 'Example', symbol: 'EX', imageUrl: 'https://evil.test/x.svg' } }));
  assert.match(fallback, />EX<\/span>/); assert.doesNotMatch(fallback, /<img/);
});

test('the existing image proxy preserves valid artwork bytes and browser caching headers', async () => {
  const { GET } = await vite.ssrLoadModule('/app/api/token-image/route.ts');
  const original = globalThis.fetch;
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=', 'base64');
  globalThis.fetch = async (url, options) => {
    assert.equal(url, icon); assert.equal(options.redirect, 'manual');
    return new Response(png, { headers: { 'content-type': 'image/png' } });
  };
  try {
    const response = await GET(new Request('https://example.test/api/token-image?src=' + encodeURIComponent(icon)));
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('content-type'), 'image/png');
    assert.equal(response.headers.get('cache-control'), 'public, max-age=86400');
    assert.deepEqual(Buffer.from(await response.arrayBuffer()), png);
  } finally { globalThis.fetch = original; }
});

test('labels and artwork recover one exact-contract identity with bounded shared work', async () => {
  const { createTokenIdentityResolver } = await vite.ssrLoadModule('/lib/tokens/icon-client.ts');
  let calls = 0;
  const resolve = createTokenIdentityResolver(async () => {
    calls++;
    return Response.json({ token: { tokenAddress: address(1), name: 'Recovered\u202e token', symbol: 'REAL', imageUrl: icon } });
  });
  const label = resolve(address(1)), avatar = resolve(address(1));
  assert.equal(label, avatar);
  assert.deepEqual(await label, { tokenAddress: address(1), name: 'Recovered token', symbol: 'REAL', imageUrl: icon });
  assert.equal((await resolve(address(1))).symbol, 'REAL');
  assert.equal(calls, 1);
  assert.equal(await resolve(address(2)), null, 'wrong-contract identity must never label another token');
});

test('token labels prefer ticker, show names once, and never use an address as a fallback', async () => {
  const { TokenLabel, CopyContract } = await vite.ssrLoadModule('/components/token-identity.tsx');
  const { createElement } = await import('react');
  const { renderToStaticMarkup: render } = await import('react-dom/server');
  const markup = token => render(createElement(TokenLabel, { token: { tokenAddress: address(1), ...token } }));
  const named = markup({ name: 'Example token', symbol: 'EX' });
  assert.match(named, /\$EX/); assert.match(named, /Example token/); assert.ok(named.indexOf('$EX') < named.indexOf('Example token'));
  assert.equal((markup({ name: 'Name only', symbol: null }).match(/Name only/g) ?? []).length, 1);
  for (const value of [null, '—', address(1), '0xc860…9595']) {
    const pending = markup({ name: value, symbol: value });
    assert.match(pending, /Token identity pending/); assert.doesNotMatch(pending, /0x/);
  }
  const copy = render(createElement(CopyContract, { address: address(1) }));
  assert.match(copy, /Copy contract address/); assert.doesNotMatch(copy, /0x/);
});

test('every quote asset remains reachable in the filter controls', async () => {
  const { CohortStrip } = await vite.ssrLoadModule('/components/cohort-strip.tsx');
  const { createElement } = await import('react');
  const { renderToStaticMarkup } = await import('react-dom/server');
  const cohorts = Array.from({ length: 39 }, (_, i) => ({ address: address(i + 1), symbol: `ASSET${i}`, attentionScore: i, color: '#fff', recentTrades: i, signal: 'steady' }));
  const html = renderToStaticMarkup(createElement(CohortStrip, { cohorts, activePair: 'ALL', onPair() {} }));
  assert.match(html, /39 quote assets observed in this window/);
  assert.match(html, /Previous quote assets/); assert.match(html, /Next quote assets/); assert.match(html, /Show all assets/);
  for (const cohort of cohorts) assert.ok(html.includes(`>${cohort.symbol}<`));
  assert.equal((html.match(/aria-pressed=/g) ?? []).length, 40);
});
