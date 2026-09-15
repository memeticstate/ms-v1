"use client";

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowDown, ArrowRight, ArrowUp, ArrowUpRight, RefreshCw } from 'lucide-react';
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
    {signal.toUpperCase()}
    {!delayed && tone === 'verified' ? <ArrowUp size={13} /> : !delayed && tone === 'stress' ? <ArrowDown size={13} /> : null}
  </span>;
}

export function FeedRow({ token, launch, transition, time, isNew = false, historical = false }: {
  token: { tokenAddress: string; symbol: string; name: string; pairSymbol: string; imageUrl?: string | null };
  launch?: PonsLaunchView; transition?: PonsTokenStateTransition | null; time?: string; isNew?: boolean; historical?: boolean;
}) {
  const signal = launch?.signal ?? (transition ? transition.to : 'unverified');
  const title = tokenText(token.symbol, 40) ?? tokenText(token.name) ?? shortTokenAddress(token.tokenAddress);
  return <Link href={`/app/token/${token.tokenAddress}`} className={styles.feedRow}>
    <TokenAvatar token={token} className={styles.tokenAvatar} tone={stateTone(signal)} />
    <div className={styles.rowIdentity}>
      <strong>{title.replace(/^\$/, '')}</strong>
      <span>{tokenText(token.name) ?? 'Identity resolving'}<b>·</b>{token.pairSymbol === 'WETH' ? 'ETH' : token.pairSymbol}</span>
    </div>
    <div className={styles.rowState}>
      {isNew ? <span className={styles.newLabel}>NEW</span> : <StateLabel signal={signal} delayed={historical} />}
      <span>{isNew ? launch ? signal.toUpperCase() : 'Not yet verified' : transition ? `${transition.from.toUpperCase()} → ${transition.to.toUpperCase()}` : historical ? 'Last observed state' : launch?.research?.eligible ? 'Participation verified' : 'Evidence needs attention'}</span>
    </div>
    {launch ? <><div className={styles.rowMetric}><strong>{launch.recentTrades.toLocaleString()}</strong><span>trades</span></div>
    <div className={styles.rowMetric}><strong>{launch.recentUniqueTraders.toLocaleString()}</strong><span>actors</span></div>
    <div className={`${styles.rowMetric} ${styles.rowChange}`}><strong>{tradeChange(launch.momentumPercent)}</strong><span>vs prior</span></div></> : <span className={styles.rowEvidence}>{isNew ? 'Participation not yet assessed' : 'Open brief for current evidence'}</span>}
    <div className={styles.rowTime}><span>{time}</span><ArrowUpRight size={16} /></div>
    {transition ? <p className={styles.rowTransition}>{transitionCopy(transition)}</p> : null}
  </Link>;
}

export function SimpleExperience() {
  const router = useRouter();
  const [view, setView] = useState<'now' | 'changed' | 'new'>('now');
  const { state, feed, changes, changesError, feedError, error, loading, now, refresh } = useSimpleState();
  useEffect(() => {
    const legacy = legacyAppDestination(window.location.search);
    if (legacy) { router.replace(legacy); return; }
    const requested = new URLSearchParams(window.location.search).get('mode');
    if (requested === 'changed' || requested === 'new') setView(requested);
  }, [router]);
  const changeView = (next: typeof view) => {
    setView(next);
    window.history.replaceState(null, '', next === 'now' ? '/app' : `/app?mode=${next}`);
  };
  const fresh = Boolean(state && currentPonsEvidence(state, now) && !error);
  const newFresh = factoryFeedFresh(feed, now) && !feedError;
  const relevant = state && fresh ? nowLaunches(state, now) : [];
  const launchesByAddress = new Map(state?.launches.map(launch => [launch.tokenAddress.toLowerCase(), launch]) ?? []);
  const events = [...new Map((feed?.events ?? []).filter(event => event.eventType === 'launch').map(event => [event.tokenAddress.toLowerCase(), event])).values()];
  const count = view === 'now' ? relevant.length : view === 'changed' ? changes.length : events.length;
  const viewError = view === 'changed' ? changesError : view === 'new' ? feedError : error;
  return <div className={styles.shell}>
    <AppHeader active="now" />
    <main className={styles.main}>
      <div className={styles.editionLine}><span>ROBINHOOD CHAIN / FIELD NOTES</span><span className={styles.freshness} data-current={view === 'new' ? newFresh : fresh}><i />{loading ? 'Reading evidence' : view === 'changed' ? changesError ? 'History unavailable' : 'Recorded state changes' : view === 'new' ? newFresh ? 'Launch feed current' : 'Launch feed delayed' : fresh ? 'Evidence current' : 'Evidence delayed'}</span></div>
      <section className={styles.feedHero}>
        <div><p className={styles.eyebrow}>THE PRESENT, WITH CONTEXT.</p><h1>What is moving<br />on Robinhood Chain<span>?</span></h1><p className={styles.heroCopy}>Notice a change. Understand the evidence. Follow what matters.</p></div>
        <aside className={styles.heroAside}><span className={styles.smallIndex}>01 / THE FIELD</span><p>Every state<br />has a history.</p><Link href="/docs/field-guide">Read the field guide <ArrowUpRight size={15} /></Link></aside>
      </section>
      <div className={styles.searchBar}><TokenSearch onSelect={token => router.push(`/app/token/${token.tokenAddress}`)} /><span className={styles.searchHint}>TOKEN / TICKER / CONTRACT</span></div>
      <div className={styles.feedToolbar}>
        <div role="tablist" aria-label="Market views" className={styles.feedTabs}>{(['now', 'changed', 'new'] as const).map(mode => <button key={mode} id={`tab-${mode}`} role="tab" aria-selected={view === mode} aria-controls="market-feed" onClick={() => changeView(mode)}>{mode.toUpperCase()}{view === mode && !loading ? <span>{count}</span> : null}</button>)}</div>
        <button className={styles.refreshButton} onClick={refresh} aria-label="Refresh market evidence"><RefreshCw size={14} /><span>Refresh</span></button>
      </div>
      <section id="market-feed" role="tabpanel" aria-labelledby={`tab-${view}`} className={styles.feed}>
        <div className={styles.feedIntro}><p>{view === 'now' ? 'Participation and stress worth a closer look.' : view === 'changed' ? 'Recorded changes, with the previous state kept in view.' : 'Confirmed factory launches. A beginning, not an endorsement.'}</p><span>{view === 'changed' ? 'LATEST PER TOKEN · 24H' : view === 'new' ? 'RECENT FACTORY WINDOW' : state ? `~${state.pulse.approximateMinutes} MIN WINDOW` : 'OBSERVED COHORT'}</span></div>
        {viewError ? <div className={styles.notice} role="status">{count ? 'The latest refresh failed. Showing the last received evidence.' : 'This evidence is temporarily unavailable.'} <button onClick={refresh}>Retry</button></div> : null}
        {loading ? <div className={styles.empty}><span className={styles.eyebrow}>READING THE FIELD</span><h2>Connecting the observations.</h2><p>Loading the latest indexed evidence.</p></div> : null}
        {!loading && view === 'now' && !fresh ? <div className={styles.empty}><span className={styles.eyebrow}>EVIDENCE DELAYED</span><h2>A current reading is not yet verified.</h2><p>The last observation {state ? `was ${relativeTime(state.generatedAt, now).toLowerCase()}` : 'is unavailable'}. Recorded history remains available.</p><Link href="/app/observe">Open the Observatory <ArrowRight size={16} /></Link></div> : null}
        {!loading && view === 'now' && fresh ? relevant.map(launch => { const matchingTransition = launch.stateTransition?.to === launch.signal ? launch.stateTransition : null; return <FeedRow key={launch.tokenAddress} token={launch} launch={launch} transition={matchingTransition} time={relativeTime(matchingTransition?.observedAt ?? state?.generatedAt, now)} />; }) : null}
        {!loading && view === 'changed' ? changes.map(record => <FeedRow key={record.tokenAddress} token={record} transition={record.transition} time={relativeTime(record.transition.observedAt, now)} historical />) : null}
        {!loading && view === 'new' ? events.map(event => { const launch = launchesByAddress.get(event.tokenAddress.toLowerCase()); const current = fresh && state && state.index.latestIndexedBlock >= event.blockNumber ? launch : undefined; return <FeedRow key={event.id} token={launch ?? { tokenAddress: event.tokenAddress, name: '', symbol: event.tokenSymbol, pairSymbol: event.pairSymbol }} launch={current} time={relativeTime(event.observedAt, now)} isNew />; }) : null}
        {!loading && !count && !viewError && (view !== 'now' || fresh) ? <div className={styles.empty}><span className={styles.eyebrow}>NOTHING TO SURFACE YET</span><h2>{view === 'changed' ? 'No changes in this observation.' : view === 'new' ? 'No launches in the current window.' : 'The field is quiet.'}</h2><p>{view === 'now' ? 'No observed token currently meets the attention criteria. Explore the full evidence or return after the next observation.' : 'New evidence will appear as the collector records it.'}</p><Link href="/app/observe">Explore the Observatory <ArrowRight size={16} /></Link></div> : null}
      </section>
      <footer className={styles.footer}><p>Market state, backed by dated evidence.</p><span>Trade activity versus prior window · addresses are not people</span><Link href="/app/observe">More instruments <ArrowUpRight size={14} /></Link></footer>
    </main>
  </div>;
}
