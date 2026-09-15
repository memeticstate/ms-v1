"use client";

import Link from 'next/link';
import { useEffect, useState, type KeyboardEvent } from 'react';
import { useRouter } from 'next/navigation';
import { Activity, ArrowDown, ArrowRight, ArrowUp, ArrowUpRight, Clock3, Compass, Grid2X2, History, List, Plus, RefreshCw } from 'lucide-react';
import { AppHeader } from './app-header';
import { TokenAvatar } from './token-avatar';
import { TokenSearch } from './token-search';
import { useSimpleState } from './use-simple-state';
import { currentPonsEvidence } from '@/lib/pons/research';
import { factoryFeedFresh } from '@/lib/pons/factory-feed';
import { nowLaunches, relativeTime, stateTone, tradeChange, transitionCopy } from '@/lib/pons/simple';
import type { PonsActivitySignal, PonsLaunchView, PonsTokenStateTransition } from '@/lib/pons/model';
import { shortTokenAddress, tokenText } from '@/lib/tokens/model';
import { legacyAppDestination } from '@/lib/app-navigation';
import styles from './simple-experience.module.css';

export function StateLabel({ signal, delayed = false }: { signal: PonsActivitySignal; delayed?: boolean }) {
  const tone = stateTone(signal);
  return <span className={styles.stateLabel} data-tone={delayed ? 'unresolved' : tone}>
    <i aria-hidden="true" />{signal.toUpperCase()}
    {!delayed && tone === 'verified' ? <ArrowUp size={12} /> : !delayed && tone === 'stress' ? <ArrowDown size={12} /> : null}
  </span>;
}

export function FeedRow({ token, launch, transition, time, isNew = false, historical = false }: {
  token: { tokenAddress: string; symbol: string; name: string; pairSymbol: string; imageUrl?: string | null };
  launch?: PonsLaunchView; transition?: PonsTokenStateTransition | null; time?: string; isNew?: boolean; historical?: boolean;
}) {
  const signal = launch?.signal ?? (transition ? transition.to : 'unverified');
  const title = tokenText(token.symbol, 40) ?? tokenText(token.name) ?? shortTokenAddress(token.tokenAddress);
  const pair = token.pairSymbol === 'WETH' ? 'ETH' : token.pairSymbol;
  const observation = isNew ? launch ? 'Current reading · ' + signal.toUpperCase() : 'Participation not yet assessed'
    : transition ? transitionCopy(transition) : historical ? 'Recorded observation' : launch?.research?.label ?? 'Evidence needs attention';
  return <Link href={'/app/token/' + token.tokenAddress} className={styles.feedRow} data-historical={historical} data-tone={stateTone(signal)}>
    <div className={styles.cardIdentity}>
      <TokenAvatar token={token} className={styles.tokenAvatar} tone={stateTone(signal)} />
      <div className={styles.rowIdentity}>
        <strong>{title.replace(/^\$/, '')}</strong>
        <span>{tokenText(token.name) ?? 'Identity resolving'}</span>
        <div className={styles.tokenMeta}><span>{pair || 'Pair resolving'}</span><span>{shortTokenAddress(token.tokenAddress)}</span></div>
      </div>
      <span className={styles.cardOpen} aria-hidden="true"><ArrowUpRight size={17} /></span>
    </div>
    <div className={styles.rowState}>
      {isNew ? <span className={styles.newLabel}><Plus size={12} />NEW LAUNCH</span> : <StateLabel signal={signal} delayed={historical} />}
      {transition ? <span className={styles.transitionPath}>{transition.from.toUpperCase() + ' → ' + transition.to.toUpperCase()}</span> : null}
    </div>
    {launch ? <div className={styles.cardMetrics}>
      <div className={styles.rowMetric}><span>Trades</span><strong>{launch.recentTrades.toLocaleString()}</strong></div>
      <div className={styles.rowMetric}><span>Actors</span><strong>{launch.recentUniqueTraders.toLocaleString()}</strong></div>
      <div className={styles.rowMetric + ' ' + styles.rowChange} data-direction={launch.momentumPercent == null ? 'unknown' : launch.momentumPercent > 0 ? 'up' : launch.momentumPercent < 0 ? 'down' : 'flat'}><span>vs prior</span><strong>{tradeChange(launch.momentumPercent)}</strong></div>
    </div> : <p className={styles.rowEvidence}>{isNew ? 'Participation not yet assessed' : 'Open brief for current evidence'}</p>}
    <p className={styles.rowTransition}>{observation}</p>
    <div className={styles.cardFooter}><span className={styles.rowTime}><Clock3 size={12} />{historical ? 'Recorded · ' : ''}{time}</span><span className={styles.briefLink}>Open brief <ArrowRight size={13} /></span></div>
  </Link>;
}

const views = [
  { id: 'now', label: 'NOW', icon: Activity },
  { id: 'changed', label: 'CHANGED', icon: History },
  { id: 'new', label: 'NEW', icon: Plus },
] as const;

export function SimpleExperience() {
  const router = useRouter();
  const [view, setView] = useState<'now' | 'changed' | 'new'>('now');
  const [layout, setLayout] = useState<'cards' | 'list'>('cards');
  const { state, feed, changes, changesError, feedError, error, loading, now, refresh } = useSimpleState();
  useEffect(() => {
    const legacy = legacyAppDestination(window.location.search);
    if (legacy) { router.replace(legacy); return; }
    const requested = new URLSearchParams(window.location.search).get('mode');
    if (requested === 'changed' || requested === 'new') setView(requested);
  }, [router]);
  const changeView = (next: typeof view) => {
    setView(next);
    window.history.replaceState(null, '', next === 'now' ? '/app' : '/app?mode=' + next);
  };
  const moveTab = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    const next = event.key === 'ArrowRight' ? (index + 1) % views.length : event.key === 'ArrowLeft' ? (index + views.length - 1) % views.length : event.key === 'Home' ? 0 : event.key === 'End' ? views.length - 1 : null;
    if (next === null) return;
    event.preventDefault(); changeView(views[next].id); document.getElementById('tab-' + views[next].id)?.focus();
  };
  const fresh = Boolean(state && currentPonsEvidence(state, now) && !error);
  const newFresh = factoryFeedFresh(feed, now) && !feedError;
  const relevant = state && fresh ? nowLaunches(state, now) : [];
  const launchesByAddress = new Map(state?.launches.map(launch => [launch.tokenAddress.toLowerCase(), launch]) ?? []);
  const events = [...new Map((feed?.events ?? []).filter(event => event.eventType === 'launch').map(event => [event.tokenAddress.toLowerCase(), event])).values()];
  const count = view === 'now' ? relevant.length : view === 'changed' ? changes.length : events.length;
  const viewError = view === 'changed' ? changesError : view === 'new' ? feedError : error;
  const current = view === 'new' ? newFresh : fresh;
  const status = loading ? 'Reading evidence' : view === 'changed' ? changesError ? 'History unavailable' : 'Recorded state changes' : view === 'new' ? newFresh ? 'Launch feed current' : 'Launch feed delayed' : fresh ? 'Evidence current' : 'Evidence delayed';
  return <div className={styles.shell}>
    <AppHeader active="now" />
    <main className={styles.main}>
      <section className={styles.feedHero}>
        <div className={styles.heroContent}><div className={styles.editionLine}><span className={styles.chainMark} aria-hidden="true"><span /><span /><span /></span>ROBINHOOD CHAIN<span className={styles.editionDivider}>/</span>LIVE OBSERVATIONS</div><h1>What is moving<span>?</span></h1><p className={styles.heroCopy}>The activity. The context. The changes that matter.</p></div>
        <Link href="/docs/field-guide" className={styles.guideCard}><span className={styles.guideIcon}><Compass size={22} strokeWidth={1.4} /></span><span><small>THE FIELD GUIDE</small><strong>Know what you’re seeing.</strong><span>How to read a Memetic State</span></span><ArrowUpRight size={18} /></Link>
      </section>
      <div className={styles.discoveryControls}>
        <div className={styles.searchBar}><TokenSearch onSelect={token => router.push('/app/token/' + token.tokenAddress)} /><span className={styles.searchHint}>TOKEN / CONTRACT</span></div>
        <Link href="/app/observe" className={styles.observeLink}><Compass size={17} /><span>Observatory</span><ArrowUpRight size={15} /></Link>
      </div>
      <div className={styles.feedToolbar}>
        <div role="tablist" aria-label="Market views" className={styles.feedTabs}>{views.map((mode, index) => <button key={mode.id} id={'tab-' + mode.id} role="tab" aria-selected={view === mode.id} aria-controls="market-feed" tabIndex={view === mode.id ? 0 : -1} onKeyDown={event => moveTab(event, index)} onClick={() => changeView(mode.id)}><mode.icon size={16} />{mode.label}{view === mode.id && !loading ? <span>{count}</span> : null}</button>)}</div>
        <div className={styles.toolbarActions}>
          <div className={styles.layoutToggle} role="group" aria-label="Feed layout"><button aria-label="Card view" aria-pressed={layout === 'cards'} onClick={() => setLayout('cards')}><Grid2X2 size={16} /></button><button aria-label="List view" aria-pressed={layout === 'list'} onClick={() => setLayout('list')}><List size={17} /></button></div>
          <button className={styles.refreshButton} onClick={refresh} aria-label="Refresh market evidence"><RefreshCw size={15} /><span>Refresh</span></button>
        </div>
      </div>
      <section id="market-feed" role="tabpanel" aria-labelledby={'tab-' + view} className={styles.feed}>
        <div className={styles.feedIntro}><p>{view === 'now' ? 'Participation and stress worth a closer look.' : view === 'changed' ? 'What changed, with the previous state kept in view.' : 'Confirmed factory launches. A beginning, not an endorsement.'}</p><span className={styles.freshness} data-current={current} data-historical={view === 'changed'}><i />{status}</span></div>
        <div className={styles.observationNote}><span>{view === 'changed' ? 'LATEST PER TOKEN · 24H' : view === 'new' ? 'RECENT FACTORY WINDOW' : state ? '~' + state.pulse.approximateMinutes + ' MIN WINDOW' : 'OBSERVED COHORT'}</span><span>{view === 'changed' ? 'Historical readings · open a brief for current evidence' : 'Trade activity versus prior window · not price change'}</span></div>
        {viewError ? <div className={styles.notice} role="status">{count ? 'The latest refresh failed. Showing the last received evidence.' : 'This evidence is temporarily unavailable.'} <button onClick={refresh}>Retry</button></div> : null}
        {loading ? <div className={styles.loadingGrid} aria-label="Loading market observations" role="status">{[0, 1, 2].map(item => <div key={item} className={styles.skeletonCard}><div><i /><span /></div><p /><p /><p /></div>)}<span className={styles.loadingText}>Loading the latest indexed evidence.</span></div> : null}
        {!loading && view === 'now' && !fresh ? <div className={styles.empty}><Activity size={30} strokeWidth={1.2} /><h2>A current reading is not yet verified.</h2><p>The last observation {state ? 'was ' + relativeTime(state.generatedAt, now).toLowerCase() : 'is unavailable'}. Recorded history remains available.</p><Link href="/app/observe">Open the Observatory <ArrowRight size={16} /></Link></div> : null}
        <div className={styles.feedGrid} data-layout={layout} data-view={view}>
          {!loading && view === 'now' && fresh ? relevant.map(launch => { const matchingTransition = launch.stateTransition?.to === launch.signal ? launch.stateTransition : null; return <FeedRow key={launch.tokenAddress} token={launch} launch={launch} transition={matchingTransition} time={relativeTime(matchingTransition?.observedAt ?? state?.generatedAt, now)} />; }) : null}
          {!loading && view === 'changed' ? changes.map(record => <FeedRow key={record.tokenAddress} token={{ ...record, imageUrl: launchesByAddress.get(record.tokenAddress.toLowerCase())?.imageUrl ?? null }} transition={record.transition} time={relativeTime(record.transition.observedAt, now)} historical />) : null}
          {!loading && view === 'new' ? events.map(event => { const launch = launchesByAddress.get(event.tokenAddress.toLowerCase()); const assessed = fresh && state && state.index.latestIndexedBlock >= event.blockNumber ? launch : undefined; return <FeedRow key={event.id} token={launch ?? { tokenAddress: event.tokenAddress, name: '', symbol: event.tokenSymbol, pairSymbol: event.pairSymbol }} launch={assessed} time={relativeTime(event.observedAt, now)} isNew />; }) : null}
        </div>
        {!loading && !count && !viewError && (view !== 'now' || fresh) ? <div className={styles.empty}><Compass size={30} strokeWidth={1.2} /><h2>{view === 'changed' ? 'No changes in this observation.' : view === 'new' ? 'No launches in the current window.' : 'The field is quiet.'}</h2><p>{view === 'now' ? 'No observed token currently meets the attention criteria. Explore the full evidence or return after the next observation.' : 'New evidence will appear as the collector records it.'}</p><Link href="/app/observe">Explore the Observatory <ArrowRight size={16} /></Link></div> : null}
      </section>
      <footer className={styles.footer}><Link href="/docs/field-guide" className={styles.mobileGuide}>Field Guide <ArrowUpRight size={14} /></Link><p><span aria-hidden="true" />Market state, backed by dated evidence.</p><span>Addresses are not people.</span><Link href="/docs/methodology">Our methodology <ArrowUpRight size={14} /></Link></footer>
    </main>
  </div>;
}
