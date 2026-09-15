"use client";

import Link from 'next/link';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import {
  Activity, ArrowDownRight, ArrowLeft, ArrowRight, ArrowUpRight, Bookmark,
  Check, ChevronDown, Clock3, Copy, ExternalLink, Fingerprint, GitBranch,
  Layers3, MessageSquare, RefreshCw, ShieldCheck, Users,
} from 'lucide-react';
import { AppHeader } from './app-header';
import { TokenAvatar } from './token-avatar';
import { useSimpleState } from './use-simple-state';
import { useMemeticAuth } from './memetic-auth-provider';
import { currentPonsEvidence, evidenceIsFresh } from '@/lib/pons/research';
import { meaningfulHolderCount, quoteFlowDirection, relativeTime, stateTone, tradeChange, transitionCopy, type TokenHistoryRecord } from '@/lib/pons/simple';
import { selectedLaunch } from '@/lib/pons/navigation';
import { createWatchEntry, parseWatchlist, WATCHLIST_STORAGE_KEY } from '@/lib/pons/watchlist';
import { tokenAddress, shortTokenAddress, tokenText } from '@/lib/tokens/model';
import { robinhoodExplorer } from '@/lib/robinhood-explorer';
import type { PonsActivitySignal, PonsLaunchView } from '@/lib/pons/model';
import styles from './token-brief.module.css';

function StateBadge({ signal, historical = false }: { signal: PonsActivitySignal; historical?: boolean }) {
  const tone = historical ? 'historical' : stateTone(signal);
  return <span className={styles.stateBadge} data-tone={tone}><i />{signal.toUpperCase()}{tone === 'verified' ? <ArrowUpRight size={13} /> : tone === 'stress' ? <ArrowDownRight size={13} /> : null}</span>;
}

function Detail({ title, note, icon, children }: { title: string; note: string; icon: ReactNode; children: ReactNode }) {
  return <details className={styles.detail}>
    <summary><span className={styles.detailIcon}>{icon}</span><span className={styles.detailTitle}>{title}<small>{note}</small></span><ChevronDown size={17} className={styles.detailChevron} /></summary>
    <div className={styles.detailBody}>{children}</div>
  </details>;
}

export function BriefStateChange({ launch, now }: { launch: PonsLaunchView; now: number }) {
  const transition = launch.stateTransition;
  if (!transition) return null;
  const currentSignal = launch.research?.signal ?? launch.signal;
  return <div className={styles.recordedChange}>
    <div className={styles.transitionTopline}><span><Clock3 size={14} />Recorded state change</span><time dateTime={transition.observedAt}>Recorded {relativeTime(transition.observedAt, now)}</time></div>
    <div className={styles.stateJourney}><StateBadge signal={transition.from} historical /><span className={styles.journeyArrow}><ArrowRight size={18} /></span><StateBadge signal={transition.to} historical /></div>
    <p className={styles.transitionMeaning}>{transitionCopy(transition)}</p>
    {transition.to !== currentSignal ? <p className={styles.transitionNotice}>
      The recorded transition ended at <strong>{transition.to.toUpperCase()}</strong>. The current reading is <strong>{currentSignal.toUpperCase()}</strong>.
    </p> : null}
  </div>;
}

export function ParticipationComparison({ launch, minutes, fresh }: { launch: PonsLaunchView; minutes?: number; fresh: boolean }) {
  const largest = Math.max(launch.recentTrades, launch.previousTrades, 1);
  const windows = [
    { label: 'Latest', trades: launch.recentTrades, actors: launch.recentUniqueTraders },
    { label: 'Prior', trades: launch.previousTrades, actors: launch.previousUniqueTraders },
  ];
  return <section className={`${styles.card} ${styles.activityCard}`} aria-label="Latest and prior indexed trade counts">
    <div className={styles.cardHeading}><div><p className={styles.overline}>PARTICIPATION</p><h2>Activity, in context.</h2></div><span className={styles.chartIcon}><Activity size={20} /></span></div>
    <p className={styles.chartDescription}>Trades per indexed window{minutes ? ` · ~${minutes} minutes each` : ''}{!fresh ? ' · delayed evidence' : ''}</p>
    <div className={styles.comparison}>
      {windows.map((window, index) => <div className={styles.comparisonRow} key={window.label}>
        <div className={styles.comparisonLabel}><span><i data-latest={index === 0} />{window.label}</span><strong>{window.trades.toLocaleString()} <small>trades</small></strong></div>
        <div className={styles.barTrack} aria-hidden="true"><span data-latest={index === 0} style={{ width: `${Math.max(0, window.trades) / largest * 100}%` }} /></div>
        <span className={styles.actorCount}>{window.actors ?? '—'} actor addresses</span>
      </div>)}
    </div>
    <div className={styles.comparisonFooter}><span>{launch.previousTrades > 0 ? 'Trade activity versus the prior window' : 'No prior trade baseline'}</span><strong>{tradeChange(launch.momentumPercent)}</strong></div>
  </section>;
}

function BriefContent({ address }: { address: string }) {
  const { state, error, loading, now, refresh } = useSimpleState(address);
  const { authenticated, identityVersion, authFetch } = useMemeticAuth();
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);
  const saveRequest = useRef<AbortController | null>(null);
  const [saveNote, setSaveNote] = useState('');
  const [copied, setCopied] = useState(false);
  const [history, setHistory] = useState<TokenHistoryRecord[]>([]);
  const [historyError, setHistoryError] = useState(false);
  const [historyPartial, setHistoryPartial] = useState(false);
  const [historyLoading, setHistoryLoading] = useState(true);
  const launch = selectedLaunch(state?.launches ?? [], address);
  const fresh = Boolean(state && !error && currentPonsEvidence(state, now));
  const evidence = launch?.currentEvidence;
  const holdersFresh = Boolean(evidence && evidence.status !== 'unavailable' && evidenceIsFresh(evidence, now));
  const transition = launch?.stateTransition;

  useEffect(() => {
    try { setSaved(parseWatchlist(localStorage.getItem(WATCHLIST_STORAGE_KEY)).some(entry => entry.tokenAddress.toLowerCase() === address)); } catch { /* Saving will report any storage failure. */ }
    setSaveNote('');
    setSaving(false);
    return () => { saveRequest.current?.abort(); saveRequest.current = null; };
  }, [address, identityVersion]);

  useEffect(() => {
    const controller = new AbortController();
    let active = true;
    const timeout = window.setTimeout(() => controller.abort(), 20_000);
    setHistoryLoading(true); setHistoryError(false);
    fetch(`/api/token-state-history?token=${address}`, { signal: controller.signal, cache: 'no-store' }).then(async response => {
      if (!response.ok) throw new Error('History unavailable');
      const data = await response.json();
      if (!Array.isArray(data.records)) throw new Error('History unavailable');
      if (!active) return;
      setHistory(data.records); setHistoryPartial(Boolean(data.partial));
    }).catch(() => { if (active) setHistoryError(true); }).finally(() => { window.clearTimeout(timeout); if (active) setHistoryLoading(false); });
    return () => { active = false; controller.abort(); window.clearTimeout(timeout); };
  }, [address, state?.generatedAt]);

  async function save() {
    if (!launch || saving) return;
    const controller = new AbortController();
    saveRequest.current?.abort(); saveRequest.current = controller;
    const timeout = window.setTimeout(() => controller.abort(), 20_000);
    setSaving(true); setSaveNote('');
    let entry = createWatchEntry(launch);
    let accountAlreadySaved = false;
    let accountReadFailed = false;
    // A save on a new device must not overwrite existing rules, alerts or dates.
    if (authenticated) {
      try {
        const response = await authFetch('/api/watchtower/watches', { cache: 'no-store', signal: controller.signal });
        if (!response.ok) throw new Error('Account watches unavailable');
        const payload = await response.json();
        if (!Array.isArray(payload.watches)) throw new Error('Account watches unavailable');
        const existing = parseWatchlist(JSON.stringify(payload.watches)).find(item => item.tokenAddress.toLowerCase() === address);
        if (existing) { entry = existing; accountAlreadySaved = true; }
      } catch { accountReadFailed = true; }
    }
    if (controller.signal.aborted) { window.clearTimeout(timeout); if (saveRequest.current === controller) { setSaveNote('Saving was interrupted. Please retry.'); setSaving(false); } return; }
    let deviceSaved = false;
    try {
      const entries = parseWatchlist(localStorage.getItem(WATCHLIST_STORAGE_KEY));
      if (!entries.some(item => item.tokenAddress === address)) localStorage.setItem(WATCHLIST_STORAGE_KEY, JSON.stringify([entry, ...entries]));
      deviceSaved = true; setSaved(true);
    } catch { /* Account saving can still succeed without local storage. */ }
    if (authenticated) {
      try {
        if (accountReadFailed) throw new Error('Account sync is unavailable. Your existing account watches were preserved.');
        if (!accountAlreadySaved) {
          const response = await authFetch('/api/watchtower/watches', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(entry), signal: controller.signal });
          if (!response.ok) throw new Error(response.status === 409 ? 'Your account save limit has been reached.' : 'Account sync is unavailable.');
        }
        if (saveRequest.current !== controller) { window.clearTimeout(timeout); return; }
        setSaved(true); setSaveNote('Saved to your account.');
      } catch (caught) { if (saveRequest.current !== controller) { window.clearTimeout(timeout); return; } setSaveNote(`${deviceSaved ? 'Saved on this device. ' : 'Could not save. '}${caught instanceof Error ? caught.message : 'Please retry.'}`); }
    } else setSaveNote(deviceSaved ? 'Saved on this device.' : 'Device storage is unavailable. Sign in to save to your account.');
    window.clearTimeout(timeout);
    setSaving(false);
  }

  async function copy() {
    try { await navigator.clipboard.writeText(address); setCopied(true); } catch { setCopied(false); }
  }

  if (loading) return <section className={styles.empty} aria-live="polite"><div className={styles.emptyIcon}><Activity size={26} /></div><span className={styles.overline}>TOKEN BRIEF</span><h1>Reading the evidence.</h1><p>Loading this token’s latest indexed observations.</p><div className={styles.loadingLine} aria-hidden="true" /></section>;
  if (!launch) return <section className={styles.empty}><div className={styles.emptyIcon}><Layers3 size={26} /></div><span className={styles.overline}>TOKEN BRIEF</span><h1>{error ? 'Evidence is temporarily unavailable.' : 'This token is not in the current evidence cohort.'}</h1><p className={styles.contract}>{address}</p><p>No state or holder-strength claim is inferred from missing evidence.</p><div className={styles.emptyActions}><button onClick={refresh}><RefreshCw size={15} />Retry evidence</button><a href={robinhoodExplorer.token(address)} target="_blank" rel="noreferrer">Inspect on Robinhood Etherscan <ArrowUpRight size={16} /></a></div></section>;

  const holderCount = meaningfulHolderCount(launch, now);
  const flowPresent = launch.netQuoteFlow !== null && launch.netQuoteFlow !== undefined;
  const comparisonPresent = launch.previousTrades > 0;
  const title = tokenText(launch.symbol, 40) ?? tokenText(launch.name) ?? shortTokenAddress(address);
  const habitat = launch.pairSymbol === 'WETH' ? 'ETH' : launch.pairSymbol;
  const currentSignal = launch.research?.signal ?? launch.signal;
  const coverage = [
    ['Onchain activity', fresh ? 'Current' : 'Delayed', fresh],
    ['Holder structure', holdersFresh ? evidence?.holdersComplete ? 'Complete returned sample' : 'Sampled' : evidence?.observedAt ? 'Sample delayed' : 'Unavailable', holdersFresh],
    ['Historical comparison', fresh && comparisonPresent ? 'Available' : comparisonPresent ? 'Recorded · delayed' : 'No prior baseline', fresh && comparisonPresent],
    ['Flow', flowPresent ? fresh ? 'Available' : 'Recorded · delayed' : 'Unavailable', fresh && flowPresent],
    ['Social / X', evidence?.social.status === 'ok' ? 'Source configured' : evidence?.social.status === 'unavailable' ? 'Unavailable' : 'Not configured', evidence?.social.status === 'ok'],
  ] as const;

  return <>
    <div className={styles.pageTopline}><span className={styles.overline}>TOKEN BRIEF</span><span className={styles.freshness} data-current={fresh}><i />{fresh ? 'Evidence current' : 'Evidence delayed'}<button onClick={refresh} aria-label="Refresh token evidence"><RefreshCw size={14} /></button></span></div>
    <section className={styles.hero} aria-label="Token identity and current reading">
      <div className={styles.heroMain}>
        <div className={styles.identity}>
          <TokenAvatar token={launch} className={styles.avatar} />
          <div className={styles.identityText}><div className={styles.identityTitle}><h1>{title.replace(/^\$/, '')}</h1><span className={styles.habitat}>{habitat}</span></div><p>{tokenText(launch.name) ?? 'Identity resolving'}</p><div className={styles.contractTools}><button onClick={() => void copy()} aria-label={copied ? 'Contract address copied' : 'Copy token contract'}><span>{shortTokenAddress(address)}</span>{copied ? <Check size={12} /> : <Copy size={12} />}</button><a href={robinhoodExplorer.token(address)} target="_blank" rel="noreferrer" aria-label="View token on Robinhood Etherscan"><ExternalLink size={13} /></a></div></div>
        </div>
        <div className={styles.currentReading}><div className={styles.readingTopline}><span>Current reading</span><StateBadge signal={currentSignal} historical={!fresh} /></div><h2>{launch.research?.label ?? 'Current participation is unverified.'}</h2><p>{fresh ? 'From the latest available evidence.' : 'Last recorded observations. Current participation is not confirmed.'}</p></div>
      </div>
      <div className={styles.actions}><Link className={styles.primaryAction} href={`/app/research?token=${address}`}><MessageSquare size={17} />Ask Memetic State<ArrowUpRight size={17} /></Link><button className={styles.saveAction} onClick={() => void save()} disabled={saving || saved}>{saved ? <Check size={16} /> : <Bookmark size={16} />}{saving ? 'Saving…' : saved ? 'Saved' : 'Save'}</button><Link className={styles.fullEvidence} href={`/app/observe?token=${address}&inspect=1`}>Full evidence<ArrowUpRight size={16} /></Link></div>
      {saveNote ? <p className={styles.saveNote} role="status">{saveNote} <Link href="/app/saved">Open Saved<ArrowUpRight size={12} /></Link></p> : null}
    </section>
    {!fresh ? <p className={styles.notice} role="status"><Clock3 size={15} /><span>These are the last recorded observations. Current participation is not confirmed. <button onClick={refresh}>Refresh evidence</button></span></p> : null}

    <section className={styles.metrics} aria-label="Primary evidence">
      <article className={styles.metric}><div className={styles.metricLabel}><Activity size={15} /><span>Trades</span></div><strong>{launch.recentTrades.toLocaleString()}</strong><p>Latest indexed window</p></article>
      <article className={styles.metric}><div className={styles.metricLabel}><Users size={15} /><span>Actors</span></div><strong>{launch.recentUniqueTraders.toLocaleString()}</strong><p>Distinct addresses</p></article>
      <article className={styles.metric} data-accent="activity"><div className={styles.metricLabel}><Activity size={15} /><span>Vs prior</span></div><strong>{tradeChange(launch.momentumPercent)}</strong><p>Trade activity</p></article>
      <article className={styles.metric} data-accent="holders"><div className={styles.metricLabel}><Fingerprint size={15} /><span>Meaningful holders</span></div><strong>{holderCount ?? '—'}{holdersFresh && evidence ? <small> / {evidence.holderSampleSize}</small> : null}</strong><p>{holdersFresh ? `Sampled · ${relativeTime(evidence?.observedAt, now)}` : 'Current sample unavailable'}</p></article>
    </section>

    <div className={styles.workspace}>
      <ParticipationComparison launch={launch} minutes={state?.pulse.approximateMinutes} fresh={fresh} />
      <section className={`${styles.card} ${styles.guidanceCard}`} data-tone={fresh ? stateTone(currentSignal) : 'unresolved'}><div className={styles.cardHeading}><div><p className={styles.overline}>{launch.research?.next ? 'CURRENT GUIDANCE' : 'RECORDED GUIDANCE'}</p><h2>Watch next</h2></div><span className={styles.guidanceIcon}><ArrowUpRight size={20} /></span></div><p className={styles.guidanceText}>{launch.research?.next ?? transition?.watchNext ?? 'Wait for a current observation before drawing a conclusion.'}</p><Link className={styles.inlineLink} href={`/app/research?token=${address}`}>Investigate this reading<ArrowRight size={15} /></Link></section>
      <section className={`${styles.card} ${styles.changeCard}`}><div className={styles.cardHeading}><div><p className={styles.overline}>STATE MEMORY</p><h2>What changed</h2></div><Clock3 size={19} className={styles.mutedIcon} /></div>{transition ? <><BriefStateChange launch={launch} now={now} /><p className={styles.observationNote}>At the recorded observation · {relativeTime(transition.observedAt, now)}:</p><ul className={styles.changeList}>{transition.whatChanged.slice(0, 3).map((reason, i) => <li key={i}><span>{String(i + 1).padStart(2, '0')}</span><p>{reason}</p></li>)}</ul></> : <><p className={styles.observationNote}>No transition is recorded yet. The current reading is based on:</p><ul className={styles.changeList}>{(launch.research?.reasons ?? [launch.signalNote]).slice(0, 2).map((reason, i) => <li key={i}><span>{String(i + 1).padStart(2, '0')}</span><p>{reason}</p></li>)}</ul></>}</section>
      <aside className={`${styles.card} ${styles.coverageCard}`}><div className={styles.cardHeading}><div><p className={styles.overline}>SOURCE COVERAGE</p><h2>What we know</h2></div><ShieldCheck size={21} className={styles.mutedIcon} /></div><dl className={styles.coverage}>{coverage.map(([label, value, present]) => <div key={label}><dt><span className={styles.coverageDot} data-present={present}>{present ? <Check size={11} /> : <span>—</span>}</span>{label}</dt><dd data-present={present}>{value}</dd></div>)}</dl><p className={styles.coverageNote}>System readings follow recorded evidence. AI interpretation is available in Research.</p></aside>
    </div>

    <section className={styles.advanced} aria-label="Advanced evidence"><div className={styles.advancedHeading}><div><p className={styles.overline}>GO DEEPER</p><h2>The full picture.</h2></div><span>Sources, context &amp; history</span></div><div className={styles.detailStack}>
      <Detail title="Participation" note="Latest and prior observation" icon={<Activity size={18} />}><dl className={styles.detailGrid}><div><dt>Latest trades / actors</dt><dd>{launch.recentTrades} / {launch.recentUniqueTraders}</dd></div><div><dt>Prior trades / actors</dt><dd>{launch.previousTrades} / {launch.previousUniqueTraders ?? '—'}</dd></div><div><dt>Latest buys / sells</dt><dd>{launch.recentBuys} / {launch.recentSells}</dd></div><div><dt>Window</dt><dd>{state?.pulse.windowBlocks.toLocaleString()} blocks · ~{state?.pulse.approximateMinutes} minutes</dd></div></dl><p>Counts cover indexed curve trading. Actor addresses do not establish distinct people or organic demand.</p></Detail>
      <Detail title="Holders" note={holdersFresh ? 'Current sample' : 'Evidence limits'} icon={<Fingerprint size={18} />}>{evidence?.observedAt ? <><p>Observed {relativeTime(evidence.observedAt, now)}. {evidence.holdersComplete ? 'Complete returned distribution.' : 'Partial holder sample; this is not the complete holder distribution.'}</p><dl className={styles.detailGrid}><div><dt>Sample basis</dt><dd>{evidence.sampleBasis ?? 'Not supplied'}</dd></div><div><dt>Wallets sampled</dt><dd>{evidence.holderSampleSize}</dd></div><div><dt>Largest sampled wallet</dt><dd>{evidence.largestWalletSharePercent === null ? '—' : `${evidence.largestWalletSharePercent.toFixed(2)}%`}</dd></div><div><dt>Reserve share</dt><dd>{evidence.reserveSharePercent === null ? '—' : `${evidence.reserveSharePercent.toFixed(2)}%`}</dd></div></dl><p>Meaningful holders retain at least 0.01% of supply; identified contracts are excluded from wallet breadth. {!holdersFresh ? 'This observation is delayed and does not establish current holder strength.' : ''}</p></> : <p>No current holder observation has been verified. Trading activity does not substitute for ownership evidence.</p>}</Detail>
      <Detail title="Flow" note="Quote movement and sell evidence" icon={<ArrowUpRight size={18} />}><dl className={styles.detailGrid}><div><dt>Net quote flow</dt><dd>{quoteFlowDirection(launch.netQuoteFlow)}</dd></div><div><dt>Creator sells</dt><dd>{launch.creatorSellEvents ?? '—'}</dd></div><div><dt>Observed peak drawdown</dt><dd>{launch.peakDrawdownPercent == null ? '—' : `${launch.peakDrawdownPercent.toFixed(1)}%`}</dd></div></dl><p>Indexed curve evidence only. Missing flow remains unavailable.</p></Detail>
      <Detail title="State history" note="Persisted observations" icon={<Clock3 size={18} />}>{historyLoading ? <p>Reading state history…</p> : historyError ? <p>State history is temporarily unavailable.</p> : history.length ? <ol className={styles.history}>{history.map((record, i) => <li key={`${record.observedAt}-${i}`}><span className={styles.historyPoint} /><time dateTime={record.observedAt}>{new Date(record.observedAt).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</time><StateBadge signal={record.signal} historical /><p>{record.label}</p></li>)}</ol> : <p>No earlier material observations have been recorded.</p>}{historyPartial ? <p>Showing the most recent 40 material observations.</p> : null}</Detail>
      <Detail title="Creator" note="Indexed lineage" icon={<GitBranch size={18} />}><a href={robinhoodExplorer.address(launch.deployerAddress)} target="_blank" rel="noreferrer" className={styles.sourceLink}>{shortTokenAddress(launch.deployerAddress)} <ArrowUpRight size={14} /></a><p>{launch.deployerLaunches} indexed launches · {launch.deployerGraduations} graduations. Lineage alone does not establish quality.</p></Detail>
      <Detail title="Raw evidence" note="Contracts, blocks, and provenance" icon={<Layers3 size={18} />}><div className={styles.sourceLinks}><a href={robinhoodExplorer.token(address)} target="_blank" rel="noreferrer">Token on Robinhood Etherscan <ArrowUpRight size={14} /></a><a href={robinhoodExplorer.address(launch.curveAddress)} target="_blank" rel="noreferrer">Curve contract <ArrowUpRight size={14} /></a><a href={robinhoodExplorer.tx(launch.txHash)} target="_blank" rel="noreferrer">Launch transaction <ArrowUpRight size={14} /></a><a href={robinhoodExplorer.block(launch.blockNumber)} target="_blank" rel="noreferrer">Launch block {launch.blockNumber.toLocaleString()} <ArrowUpRight size={14} /></a></div><p>Evidence generated {state?.generatedAt}. Data is produced by the Memetic State collector and canonical D1 ledger.</p>{evidence?.errors.length ? <ul>{evidence.errors.map((message, i) => <li key={i}>{message}</li>)}</ul> : null}<button onClick={() => void copy()} className={styles.copyAddress}><Copy size={13} />{copied ? 'Copied' : 'Copy contract'}<code>{address}</code></button></Detail>
    </div></section>
    <footer className={styles.footer}><span><ShieldCheck size={14} />Observed market state, with evidence.</span><Link href="/docs/methodology">Methodology<ArrowUpRight size={13} /></Link></footer>
  </>;
}

export function TokenBrief({ address }: { address: string }) {
  const valid = tokenAddress(address);
  return <div className={styles.shell}><AppHeader active="now" /><main className={styles.main}><Link href="/app" className={styles.backLink}><ArrowLeft size={15} />Back to the field</Link>{valid ? <BriefContent key={valid} address={valid} /> : <section className={styles.empty}><div className={styles.emptyIcon}><Layers3 size={25} /></div><h1>This contract address is invalid.</h1><p>Search with a ticker or a complete Robinhood Chain token contract.</p><Link href="/app">Return to search<ArrowRight size={15} /></Link></section>}</main></div>;
}
