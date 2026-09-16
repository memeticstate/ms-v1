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
