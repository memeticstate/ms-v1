"use client";

import Link from 'next/link';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { ArrowLeft, ArrowRight, ArrowUpRight, Bookmark, Check, Copy, Plus } from 'lucide-react';
import { AppHeader } from './app-header';
import { StateLabel } from './simple-experience';
import { TokenAvatar } from './token-avatar';
import { useSimpleState } from './use-simple-state';
import { useMemeticAuth } from './memetic-auth-provider';
import { currentPonsEvidence, evidenceIsFresh } from '@/lib/pons/research';
import { meaningfulHolderCount, quoteFlowDirection, relativeTime, tradeChange, transitionCopy, type TokenHistoryRecord } from '@/lib/pons/simple';
import { selectedLaunch } from '@/lib/pons/navigation';
import { createWatchEntry, parseWatchlist, WATCHLIST_STORAGE_KEY } from '@/lib/pons/watchlist';
import { tokenAddress, shortTokenAddress, tokenText } from '@/lib/tokens/model';
import { robinhoodExplorer } from '@/lib/robinhood-explorer';
import type { PonsLaunchView } from '@/lib/pons/model';
import styles from './simple-experience.module.css';

function Detail({ title, note, children }: { title: string; note: string; children: ReactNode }) {
  return <details className={styles.detail}><summary><span>{title}<small>{note}</small></span><Plus size={17} /></summary><div className={styles.detailBody}>{children}</div></details>;
}

export function BriefStateChange({ launch, now }: { launch: PonsLaunchView; now: number }) {
  const transition = launch.stateTransition;
  if (!transition) return null;
  const currentSignal = launch.research?.signal ?? launch.signal;
  return <>
    <div className={styles.briefTransition}>
      <span>{transition.from.toUpperCase()} <ArrowRight size={15} /> {transition.to.toUpperCase()}</span>
      <span>Recorded {relativeTime(transition.observedAt, now)}</span>
      <p>Recorded state change: {transitionCopy(transition)}</p>
    </div>
    {transition.to !== currentSignal ? <p className={styles.notice}>
      The recorded transition ended at <strong>{transition.to.toUpperCase()}</strong>. The current reading is <strong>{currentSignal.toUpperCase()}</strong>.
    </p> : null}
  </>;
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

  if (loading) return <div className={styles.empty}><span className={styles.eyebrow}>TOKEN BRIEF</span><h1>Reading this part of the field.</h1><p>Loading the token’s canonical evidence.</p></div>;
  if (!launch) return <div className={styles.empty}><span className={styles.eyebrow}>TOKEN BRIEF</span><h1>{error ? 'Evidence is temporarily unavailable.' : 'This token is not in the current evidence cohort.'}</h1><p className={styles.contract}>{address}</p><p>No state or holder-strength claim is inferred from missing evidence.</p><button onClick={refresh}>Retry evidence</button><a href={robinhoodExplorer.token(address)} target="_blank" rel="noreferrer">Inspect on Robinhood Etherscan <ArrowUpRight size={16} /></a></div>;

  const holderCount = meaningfulHolderCount(launch, now);
  const flowPresent = launch.netQuoteFlow !== null && launch.netQuoteFlow !== undefined;
  const comparisonPresent = launch.previousTrades > 0;
  const title = tokenText(launch.symbol, 40) ?? tokenText(launch.name) ?? shortTokenAddress(address);
  const coverage = [
    ['Onchain activity', fresh ? 'Current' : 'Delayed', fresh],
    ['Holder structure', holdersFresh ? evidence?.holdersComplete ? 'Complete returned sample' : 'Sampled' : evidence?.observedAt ? 'Sample delayed' : 'Unavailable', holdersFresh],
    ['Historical comparison', fresh && comparisonPresent ? 'Available' : comparisonPresent ? 'Recorded · delayed' : 'No prior baseline', fresh && comparisonPresent],
    ['Flow', flowPresent ? fresh ? 'Available' : 'Recorded · delayed' : 'Unavailable', fresh && flowPresent],
    ['Social / X', evidence?.social.status === 'ok' ? 'Source configured' : evidence?.social.status === 'unavailable' ? 'Unavailable' : 'Not configured', evidence?.social.status === 'ok'],
  ] as const;

  return <>
    <div className={styles.briefTopline}><span className={styles.eyebrow}>TOKEN BRIEF / SYSTEM READ</span><span className={styles.freshness} data-current={fresh}><i />{fresh ? 'Evidence current' : 'Evidence delayed'}</span></div>
    <section className={styles.briefHero}>
      <div className={styles.briefIdentity}><TokenAvatar token={launch} className={styles.briefAvatar} /><div><h1>{title.replace(/^\$/, '')}</h1><p>{launch.name} <span>· {launch.pairSymbol === 'WETH' ? 'ETH' : launch.pairSymbol} HABITAT</span></p></div><StateLabel signal={launch.signal} delayed={!fresh} /></div>
      <p className={styles.briefReading}>{launch.research?.label ?? 'Current participation is unverified.'}</p>
      {transition ? <BriefStateChange launch={launch} now={now} /> : <p className={styles.noTransition}>No earlier state change has been recorded.</p>}
      {!fresh ? <p className={styles.notice} role="status">These are the last recorded observations. Current participation is not confirmed. <button onClick={refresh}>Refresh evidence</button></p> : null}
    </section>
    <section className={styles.briefMetrics} aria-label="Primary evidence">
      <div><strong>{launch.recentTrades.toLocaleString()}</strong><span>TRADES</span><small>Latest indexed window</small></div>
      <div><strong>{launch.recentUniqueTraders.toLocaleString()}</strong><span>ACTORS</span><small>Distinct addresses</small></div>
      <div><strong>{tradeChange(launch.momentumPercent)}</strong><span>VS PRIOR</span><small>Trade activity</small></div>
      <div><strong>{holderCount ?? '—'}</strong><span>MEANINGFUL HOLDERS</span><small>{holdersFresh ? `Sampled · ${relativeTime(evidence?.observedAt, now)}` : 'Current sample unavailable'}</small></div>
    </section>
    <div className={styles.briefColumns}>
      <div className={styles.briefEditorial}>
        <section><p className={styles.sectionNumber}>01 / THE CHANGE</p><h2>What changed</h2>{transition ? <><p>At the recorded observation · {relativeTime(transition.observedAt, now)}:</p><ul>{transition.whatChanged.slice(0, 3).map((reason, i) => <li key={i}>{reason}</li>)}</ul></> : <><p>No transition is recorded yet. The current reading is based on:</p><ul>{(launch.research?.reasons ?? [launch.signalNote]).slice(0, 2).map((reason, i) => <li key={i}>{reason}</li>)}</ul></>}</section>
        <section className={styles.watchNext}><p className={styles.sectionNumber}>02 / {launch.research?.next ? 'CURRENT GUIDANCE' : 'RECORDED GUIDANCE'}</p><h2>Watch next</h2><p>{launch.research?.next ?? transition?.watchNext ?? 'Wait for a current observation before drawing a conclusion.'}</p></section>
      </div>
      <aside className={styles.evidenceColumn}><p className={styles.sectionNumber}>SOURCE COVERAGE</p><h2>What we know</h2><dl className={styles.coverage}>{coverage.map(([label, value, present]) => <div key={label}><dt>{label}</dt><dd data-present={present}>{present ? <Check size={13} /> : <span>—</span>}{value}</dd></div>)}</dl><p className={styles.coverageNote}>System readings follow recorded evidence. AI interpretation is available in Research.</p></aside>
    </div>
    <div className={styles.briefActions}><Link className={styles.primaryAction} href={`/app/research?token=${address}`}>Ask Memetic State <ArrowUpRight size={17} /></Link><button className={styles.saveAction} onClick={() => void save()} disabled={saving || saved}>{saved ? <Check size={16} /> : <Bookmark size={16} />}{saving ? 'Saving…' : saved ? 'Saved' : 'Save'}</button><Link className={styles.fullEvidence} href={`/app/observe?token=${address}&inspect=1`}>Full evidence <ArrowRight size={16} /></Link></div>
    {saveNote ? <p className={styles.saveNote} role="status">{saveNote} <Link href="/app/saved">Open Saved</Link></p> : null}
    <section className={styles.details} aria-label="Advanced evidence">
      <Detail title="Participation" note="Latest and prior observation"><dl className={styles.detailGrid}><div><dt>Latest trades / actors</dt><dd>{launch.recentTrades} / {launch.recentUniqueTraders}</dd></div><div><dt>Prior trades / actors</dt><dd>{launch.previousTrades} / {launch.previousUniqueTraders ?? '—'}</dd></div><div><dt>Latest buys / sells</dt><dd>{launch.recentBuys} / {launch.recentSells}</dd></div><div><dt>Window</dt><dd>{state?.pulse.windowBlocks.toLocaleString()} blocks · ~{state?.pulse.approximateMinutes} minutes</dd></div></dl><p>Counts cover indexed curve trading. Actor addresses do not establish distinct people or organic demand.</p></Detail>
      <Detail title="Holders" note={holdersFresh ? 'Current sample' : 'Evidence limits'}>{evidence?.observedAt ? <><p>Observed {relativeTime(evidence.observedAt, now)}. {evidence.holdersComplete ? 'Complete returned distribution.' : 'Partial holder sample; this is not the complete holder distribution.'}</p><dl className={styles.detailGrid}><div><dt>Sample basis</dt><dd>{evidence.sampleBasis ?? 'Not supplied'}</dd></div><div><dt>Wallets sampled</dt><dd>{evidence.holderSampleSize}</dd></div><div><dt>Largest sampled wallet</dt><dd>{evidence.largestWalletSharePercent === null ? '—' : `${evidence.largestWalletSharePercent.toFixed(2)}%`}</dd></div><div><dt>Reserve share</dt><dd>{evidence.reserveSharePercent === null ? '—' : `${evidence.reserveSharePercent.toFixed(2)}%`}</dd></div></dl><p>Meaningful holders retain at least 0.01% of supply; identified contracts are excluded from wallet breadth. {!holdersFresh ? 'This observation is delayed and does not establish current holder strength.' : ''}</p></> : <p>No current holder observation has been verified. Trading activity does not substitute for ownership evidence.</p>}</Detail>
      <Detail title="Flow" note="Quote movement and sell evidence"><dl className={styles.detailGrid}><div><dt>Net quote flow</dt><dd>{quoteFlowDirection(launch.netQuoteFlow)}</dd></div><div><dt>Creator sells</dt><dd>{launch.creatorSellEvents ?? '—'}</dd></div><div><dt>Observed peak drawdown</dt><dd>{launch.peakDrawdownPercent == null ? '—' : `${launch.peakDrawdownPercent.toFixed(1)}%`}</dd></div></dl><p>Indexed curve evidence only. Missing flow remains unavailable.</p></Detail>
      <Detail title="State history" note="Persisted observations">{historyLoading ? <p>Reading state history…</p> : historyError ? <p>State history is temporarily unavailable.</p> : history.length ? <ol className={styles.history}>{history.map((record, i) => <li key={`${record.observedAt}-${i}`}><time dateTime={record.observedAt}>{new Date(record.observedAt).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</time><StateLabel signal={record.signal} delayed /><span>{record.label}</span></li>)}</ol> : <p>No earlier material observations have been recorded.</p>}{historyPartial ? <p>Showing the most recent 40 material observations.</p> : null}</Detail>
      <Detail title="Creator" note="Indexed lineage"><a href={robinhoodExplorer.address(launch.deployerAddress)} target="_blank" rel="noreferrer" className={styles.sourceLink}>{shortTokenAddress(launch.deployerAddress)} <ArrowUpRight size={14} /></a><p>{launch.deployerLaunches} indexed launches · {launch.deployerGraduations} graduations. Lineage alone does not establish quality.</p></Detail>
      <Detail title="Raw evidence" note="Contracts, blocks, and provenance"><div className={styles.sourceLinks}><a href={robinhoodExplorer.token(address)} target="_blank" rel="noreferrer">Token on Robinhood Etherscan <ArrowUpRight size={14} /></a><a href={robinhoodExplorer.address(launch.curveAddress)} target="_blank" rel="noreferrer">Curve contract <ArrowUpRight size={14} /></a><a href={robinhoodExplorer.tx(launch.txHash)} target="_blank" rel="noreferrer">Launch transaction <ArrowUpRight size={14} /></a><a href={robinhoodExplorer.block(launch.blockNumber)} target="_blank" rel="noreferrer">Launch block {launch.blockNumber.toLocaleString()} <ArrowUpRight size={14} /></a></div><p>Evidence generated {state?.generatedAt}. Data is produced by the Memetic State collector and canonical D1 ledger.</p>{evidence?.errors.length ? <ul>{evidence.errors.map((message, i) => <li key={i}>{message}</li>)}</ul> : null}<button onClick={() => void copy()} className={styles.copyAddress}><Copy size={13} />{copied ? 'Copied' : 'Copy contract'}<code>{address}</code></button></Detail>
    </section>
    <footer className={styles.footer}><span>Observed market state · no social claim is inferred from missing sources.</span><Link href="/docs/methodology">Methodology <ArrowUpRight size={14} /></Link></footer>
  </>;
}

export function TokenBrief({ address }: { address: string }) {
  const valid = tokenAddress(address);
  return <div className={styles.shell}><AppHeader active="now" /><main className={`${styles.main} ${styles.briefMain}`}><Link href="/app" className={styles.backLink}><ArrowLeft size={15} />Back to the field</Link>{valid ? <BriefContent key={valid} address={valid} /> : <div className={styles.empty}><h1>This contract address is invalid.</h1><p>Search with a ticker or a complete Robinhood Chain token contract.</p><Link href="/app">Return to search</Link></div>}</main></div>;
}
