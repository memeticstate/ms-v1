import assert from 'node:assert/strict';
import test, { after } from 'node:test';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';

const root = fileURLToPath(new URL('..', import.meta.url));
const vite = await createServer({ appType: 'custom', configFile: false, root,
  resolve: { alias: { '@': root } }, server: { middlewareMode: true, hmr: false } });
after(() => vite.close());
const { nowLaunches, meaningfulHolderCount, tradeChange, transitionCopy, relativeTime, quoteFlowDirection } = await vite.ssrLoadModule('/lib/pons/simple.ts');
const { factoryFeedFresh } = await vite.ssrLoadModule('/lib/pons/factory-feed.ts');
const now = Date.parse('2026-09-15T19:30:00Z');
const timestamp = new Date(now).toISOString();
const steady = { signal: 'steady', research: { eligible: true } };
const stressed = { signal: 'stressed', research: { eligible: false } };
const unverified = { signal: 'unverified', research: { eligible: false } };
const inactive = { signal: 'inactive', research: { eligible: false } };
const state = { mode: 'live', generatedAt: timestamp,
  index: { lastSuccessAt: timestamp, consecutiveFailures: 0, liveLagBlocks: 64 },
  collector: { status: 'succeeded' }, integrity: { pulseReconciled: true },
  launches: [steady, stressed, unverified, inactive] };

test('NOW selects canonical participation and stress without changing eligibility', () => {
  assert.deepEqual(nowLaunches(state, now), [steady, stressed]);
  assert.equal(stressed.research.eligible, false);
  assert.equal(unverified.signal, 'unverified');
});

test('fresh collection progress cannot promote old, future, failed or mismatched state evidence', () => {
  const old = { ...state, generatedAt: new Date(now - 5 * 60_000).toISOString(),
    collectionProgress: { lastSuccessAt: timestamp, lagBlocks: 64 } };
  assert.deepEqual(nowLaunches(old, now), []);
  assert.deepEqual(nowLaunches({ ...state, generatedAt: new Date(now + 60_000).toISOString() }, now), []);
  assert.deepEqual(nowLaunches({ ...state, collector: { status: 'failed' } }, now), []);
  assert.deepEqual(nowLaunches({ ...state, integrity: { pulseReconciled: false } }, now), []);
});

test('missing and expired holder samples stay missing while observed zero remains zero', () => {
  const evidence = { observedAt: timestamp, checkedAt: timestamp, status: 'partial', meaningfulHolders: 21 };
  assert.equal(meaningfulHolderCount({ currentEvidence: evidence }, now), 21);
  assert.equal(meaningfulHolderCount({ currentEvidence: { ...evidence, meaningfulHolders: 0 } }, now), 0);
  assert.equal(meaningfulHolderCount({ currentEvidence: { ...evidence, observedAt: new Date(now - 601_000).toISOString() } }, now), null);
  assert.equal(meaningfulHolderCount({ currentEvidence: { ...evidence, status: 'unavailable' } }, now), null);
  assert.equal(meaningfulHolderCount({}, now), null);
});

test('cleared stress without verified participation is never described as recovery', () => {
  assert.equal(transitionCopy({ from: 'stressed', to: 'unverified', kind: 'stress-cleared', label: 'Recovered' }), 'Stress no longer confirmed');
  assert.equal(transitionCopy({ from: 'stressed', to: 'steady', kind: 'recovered', label: 'Participation recovered' }), 'Participation recovered');
});

test('trade comparisons preserve missing baselines, real zero and sign', () => {
  assert.equal(tradeChange(null), '—');
  assert.equal(tradeChange(undefined), '—');
  assert.equal(tradeChange(NaN), '—');
  assert.equal(tradeChange(0), '0%');
  assert.equal(tradeChange(17.2), '+17%');
  assert.equal(tradeChange(-58.7), '-59%');
});

test('raw quote magnitudes are displayed only as direction without guessed decimals', () => {
  assert.equal(quoteFlowDirection(1e18), 'Net inflow');
  assert.equal(quoteFlowDirection(-1e6), 'Net outflow');
  assert.equal(quoteFlowDirection(0), 'Balanced');
  assert.equal(quoteFlowDirection(null), '—');
  assert.equal(quoteFlowDirection(Infinity), '—');
});

test('freshness rejects future factory timestamps and an index beyond its observed head', () => {
  const feed = { indexedBlock: 100, headBlock: 164, observedAt: timestamp, consecutiveFailures: 0, lastError: null };
  assert.equal(factoryFeedFresh(feed, now), true);
  assert.equal(factoryFeedFresh({ ...feed, observedAt: new Date(now + 60_000).toISOString() }, now), false);
  assert.equal(factoryFeedFresh({ ...feed, headBlock: 99 }, now), false);
  assert.equal(factoryFeedFresh({ ...feed, observedAt: 'invalid' }, now), false);
});

test('unavailable and future timestamps are explicit instead of appearing current', () => {
  assert.equal(relativeTime(null, now), 'Time unavailable');
  assert.equal(relativeTime('invalid', now), 'Time unavailable');
  assert.equal(relativeTime(new Date(now + 60_000).toISOString(), now), 'Timestamp ahead');
  assert.equal(relativeTime(new Date(now - 12 * 60_000).toISOString(), now), '12m ago');
});

test('a recorded change renders its dated state without inventing current counts or verification', async () => {
  const { createElement } = await import('react');
  const { renderToStaticMarkup } = await import('react-dom/server');
  const { FeedRow } = await vite.ssrLoadModule('/components/simple-experience.tsx');
  const address = '0x' + 'a'.repeat(40);
  const transition = { from: 'stressed', to: 'unverified', label: 'Stress no longer confirmed' };
  const html = renderToStaticMarkup(createElement(FeedRow, {
    token: { tokenAddress: address, symbol: 'SOCIAL', name: 'Socializers', pairSymbol: 'ETH' },
    transition, time: '12m ago', historical: true,
  }));
  assert.match(html, new RegExp(`/app/token/${address}`));
  assert.match(html, /STRESSED → UNVERIFIED/);
  assert.match(html, /Stress no longer confirmed/);
  assert.match(html, /Open brief for current evidence/);
  assert.doesNotMatch(html, /Participation verified|>0<|vs prior/);
});
