"use client";

import { robinhoodExplorer } from "@/lib/robinhood-explorer";

import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowUpRight, ArrowRight, RefreshCw } from "lucide-react";
import { AppHeader } from "@/components/app-header";
import { Button } from "@/components/ui/button";
import { TokenAvatar } from "@/components/token-avatar";
import { TokenSearch } from "@/components/token-search";
import { FactoryActivity } from "@/components/factory-activity";
import { useFactoryStream } from "@/components/use-factory-stream";
import { MEMETIC_TOKEN_ADDRESS, MEMETIC_TOKEN_EXPLORER_URL } from "@/lib/memetic-token";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { currentPonsEvidence } from "@/lib/pons/research";
import { tokenAppHref } from "@/lib/pons/landing";
import type { PonsStateResponse } from "@/lib/pons/model";
import { shortTokenAddress, tokenTitle, tokenSubtitle, type TokenDiscoveryResponse } from "@/lib/tokens/model";
import { radarReadings, within, type RadarReading } from "@/lib/tokens/radar";
import styles from "./memetic-landing.module.css";

const dateLabel = (value: string | null | undefined) => {
  if (!value || !Number.isFinite(Date.parse(value))) return "Not available";
  return new Intl.DateTimeFormat("en", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "UTC" }).format(new Date(value)) + " UTC";
};

function EvidencePreview({ item }: { item: RadarReading }) {
  return <aside className={styles.reading} aria-label={`Reading for ${tokenTitle(item.token)}`}>
    <p className={styles.eyebrow}>{item.kind === "research" ? "The short reading" : "Why it’s here"}</p>
    <h3 className={styles.readingToken}>{tokenTitle(item.token)}</h3>
    <p className={styles.readingHeadline}>{item.summary}</p>
    <p className={styles.readingExplanation}>{item.explanation}</p>
    <dl className={styles.evidenceList}>
      <div><dt>What supports it</dt><dd>{item.support}</dd></div>
      <div><dt>What remains uncertain</dt><dd>{item.uncertainty}</dd></div>
    </dl>
    <Button asChild className={styles.evidenceButton}><a href={tokenAppHref(item.token.tokenAddress)}>{item.kind === "research" ? "Inspect full evidence" : "Open token details"} <ArrowUpRight aria-hidden="true" /></a></Button>
    <p className={styles.readingTime}>{item.evidenceLabel}: {dateLabel(item.evidenceAt)}</p>
    <a className={styles.contractLink} href={robinhoodExplorer.address(item.token.tokenAddress)} target="_blank" rel="noreferrer">{shortTokenAddress(item.token.tokenAddress)} <ArrowUpRight aria-hidden="true" /></a>
  </aside>;
}

export function MemeticLanding() {
  const factoryStream = useFactoryStream(null);
  const [state, setState] = useState<PonsStateResponse | null>(null);
  const [discovery, setDiscovery] = useState<TokenDiscoveryResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [clock, setClock] = useState(0);
  const [tab, setTab] = useState<"changes" | "launches">("changes");
  const [selected, setSelected] = useState<string | null>(null);
  const requestRef = useRef<AbortController | null>(null);
  const coldStartRef = useRef(false);
  const coldStartRetriesRef = useRef(0);

  const refresh = useCallback(async () => {
    if (requestRef.current) return;
    const controller = new AbortController();
    requestRef.current = controller;
    const timeout = window.setTimeout(() => controller.abort(), 25_000);
    setLoading(true);
    try {
      await Promise.allSettled([
        (async () => {
          try {
            const response = await fetch("/api/token-radar", { signal: controller.signal, cache: "no-store" });
            if (!response.ok) throw new Error("Discovery unavailable");
            const next = await response.json() as TokenDiscoveryResponse;
            if (!Array.isArray(next.markets) || !Array.isArray(next.launches)) throw new Error("Incomplete discovery");
            if (requestRef.current === controller) {
              coldStartRef.current = Boolean(next.partial && ((!next.markets.length && !next.launches.length) || !within(next.fetchedAt, 120_000, Date.now())));
              if (!coldStartRef.current) coldStartRetriesRef.current = 0;
              setDiscovery(next); setError(false); setClock(Date.now()); setLoading(false);
            }
          } catch { if (requestRef.current === controller) setError(true); }
        })(),
      ]);
    } finally {
      window.clearTimeout(timeout);
      if (requestRef.current === controller) {
        requestRef.current = null;
        setLoading(false);
      }
    }
  }, []);

  // Historical research is optional enrichment. Its request lifetime must never
  // hold the current market feed's refresh lock or loading state.
  useEffect(() => {
    let active = true;
    let request: AbortController | null = null;
    const read = async () => {
      if (request || document.visibilityState !== "visible") return;
      const controller = new AbortController(); request = controller;
      const timeout = window.setTimeout(() => controller.abort(), 20_000);
      try {
        const response = await fetch("/api/pons-state", { signal: controller.signal, cache: "no-store" });
        if (!response.ok) return;
        const next = await response.json() as PonsStateResponse;
        if (active && Array.isArray(next.launches) && next.index && next.integrity && next.collector) { setState(next); setClock(Date.now()); }
      } catch { /* Discovery and factory events have their own independent reads. */ }
      finally { window.clearTimeout(timeout); request = null; }
    };
    void read();
    const timer = window.setInterval(() => void read(), 60_000);
    return () => { active = false; request?.abort(); window.clearInterval(timer); };
  }, []);

  useEffect(() => {
    const initial = window.setTimeout(() => void refresh(), 0);
    const interval = window.setInterval(() => {
      if (document.visibilityState === "visible") void refresh();
    }, 15_000);
    const coldStartRetry = window.setInterval(() => {
      if (coldStartRef.current && coldStartRetriesRef.current < 3 && !requestRef.current && document.visibilityState === "visible") {
        coldStartRetriesRef.current += 1;
        void refresh();
      }
    }, 5_000);
    // Expire successful responses even if later requests fail or the tab sleeps.
    const tick = window.setInterval(() => {
      if (document.visibilityState === "visible") setClock(Date.now());
    }, 15_000);
    const resume = () => {
      if (document.visibilityState === "visible") { setClock(Date.now()); void refresh(); }
    };
    document.addEventListener("visibilitychange", resume);
    return () => {
      window.clearTimeout(initial); window.clearInterval(interval); window.clearInterval(tick); window.clearInterval(coldStartRetry);
      document.removeEventListener("visibilitychange", resume);
      requestRef.current?.abort(); requestRef.current = null;
    };
  }, [refresh]);

  const fresh = state ? currentPonsEvidence(state, clock) : false;
  const items = radarReadings(state, discovery, tab, clock);
  const active = items.find((item) => item.token.tokenAddress === selected) ?? items[0];
  const discoveryFresh = Boolean(discovery && within(discovery.fetchedAt, 120_000, clock) && !discovery.partial);
  const showReading = () => {
    document.getElementById("landing-reading")?.scrollIntoView({ behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth", block: "center" });
    document.getElementById("landing-reading")?.focus({ preventScroll: true });
  };
  const selectReading = (address: string) => {
    setSelected(address);
    if (window.matchMedia("(max-width: 760px)").matches) window.requestAnimationFrame(showReading);
  };

  return <main className={styles.landing}>
    <a className={styles.skipLink} href="#radar">Skip to signals</a>
    <AppHeader active="home" />

    <section className={styles.hero} aria-labelledby="landing-title">
      <div>
        <p className={styles.eyebrow}>Independent attention intelligence</p>
        <h1 id="landing-title">See what’s moving.<br />Understand <em>why.</em></h1>
      </div>
      <div className={styles.heroIntro}>
        <p>Track new tokens, spot changing activity, and inspect the evidence on Robinhood Chain.</p>
        <div className={styles.heroActions}>
          <Button asChild className={styles.openButton}><a href="/app">Open app <ArrowUpRight aria-hidden="true" /></a></Button>
          <button type="button" onClick={showReading} className={styles.textLink}>How to read a signal</button>
        </div>
        <p className={styles.heroNote}>Public evidence. No wallet needed to explore.</p>
      </div>
    </section>

    <div className={styles.liveFeed}><FactoryActivity stream={factoryStream} onInspect={event => window.location.assign(tokenAppHref(event.tokenAddress))} /></div>

    <section id="radar" className={styles.radar} aria-labelledby="radar-title">
      <div className={styles.radarInner}>
        <div className={styles.radarHeading}>
          <h2 id="radar-title">On the radar</h2>
          <div className={styles.freshness} role="status">
            <span data-fresh={fresh}>{loading && !discovery ? "Loading tokens" : error ? "Refresh interrupted" : discoveryFresh ? "PONS market snapshot" : "Some sources delayed"}</span>
            <button type="button" onClick={() => void refresh()} disabled={loading} aria-label="Refresh landing-page evidence"><RefreshCw aria-hidden="true" className={loading ? styles.refreshing : undefined} /></button>
          </div>
        </div>
        {state && !fresh ? <p className={styles.coverageNote}>Market discovery is available while our deeper trade history catches up. <a href="/app/observe?view=evidence">Research coverage <ArrowUpRight aria-hidden="true" /></a></p> : null}
        {error || discovery?.partial ? <p role="status" className={styles.coverageNote}>Some market data couldn’t refresh. Only readings with sufficiently recent observations appear below.</p> : null}

        <div className={styles.searchRow} role="search" aria-label="Search Robinhood Chain tokens">
          <TokenSearch appearance="landing" onSelect={token => window.location.assign(tokenAppHref(token.tokenAddress))} />
          <span className={styles.chainLabel}>Robinhood Chain</span>
        </div>

        <Tabs value={tab} onValueChange={(value) => { setTab(value as "changes" | "launches"); setSelected(null); }} className={styles.tabs}>
          <div className={styles.tabBar}>
            <TabsList variant="line" className={styles.tabList} aria-label="Signal preview">
              <TabsTrigger value="changes" className={styles.tab}>Recent activity</TabsTrigger>
              <TabsTrigger value="launches" className={styles.tab}>New launches</TabsTrigger>
            </TabsList>
            <a className={styles.explorerLink} href="/app/observe">Open full explorer <ArrowUpRight aria-hidden="true" /></a>
          </div>
          {(["changes", "launches"] as const).map((value) => <TabsContent key={value} value={value} className={styles.tabContent}>
            <p className={styles.previewNote}>{tab === "launches" ? "Newly listed on PONS. A launch alone doesn’t establish momentum." : "Current research readings first, then larger graduated markets with a buy reported in the past hour."}</p>
            {items.length ? <div className={styles.workspace}>
              <div className={styles.signalList} aria-label="Token readings">
                {items.map((item) => <div key={item.token.tokenAddress} className={styles.signalRow} data-selected={active?.token.tokenAddress === item.token.tokenAddress}>
                  <button type="button" className={styles.rowSelect} aria-pressed={active?.token.tokenAddress === item.token.tokenAddress} aria-controls="landing-reading" onClick={() => selectReading(item.token.tokenAddress)} aria-label={`Preview ${tokenTitle(item.token)}: ${item.summary}`}>
                    <TokenAvatar token={item.token} className={styles.avatar} tone={item.tone} />
                    <span className={styles.tokenIdentity}><strong>{tokenTitle(item.token)}</strong><span>{tokenSubtitle(item.token)}</span><code>{shortTokenAddress(item.token.tokenAddress)}</code></span>
                    <span className={styles.signalSummary}>{item.summary}</span>
                    <span className={styles.badge} data-tone={item.tone}>{item.label}</span>
                  </button>
                  <a className={styles.rowLink} href={tokenAppHref(item.token.tokenAddress)} aria-label={`Open ${tokenTitle(item.token)} details in the app`} title="Open token details"><ArrowUpRight aria-hidden="true" /></a>
                </div>)}
              </div>
              <div id="landing-reading" tabIndex={-1} className={styles.readingTarget}>{active ? <EvidencePreview item={active} /> : null}</div>
            </div> : <div id="landing-reading" tabIndex={-1} className={styles.empty} aria-live="polite">
              <p className={styles.eyebrow}>On the radar</p>
              <h3>{loading ? "Finding recent activity…" : error || discovery?.partial ? "The market source is temporarily unavailable." : "No recent observations meet these checks."}</h3>
              <p>{loading ? "Loading token identities and their latest available observations." : "Search any token above, try New launches, or explore the dated records in the full app."}</p>
              <div className={styles.emptyActions}>
                <Button className={styles.evidenceButton} onClick={() => void refresh()} disabled={loading}>Try again <RefreshCw aria-hidden="true" /></Button>
                <a href="/app/observe?view=evidence" className={styles.textLink}>Open the evidence workspace <ArrowUpRight aria-hidden="true" /></a>
              </div>
            </div>}
          </TabsContent>)}
        </Tabs>
        <div className={styles.radarFootnote}>
          <p>PONS market activity and Memetic research have separate evidence checks. Neither is a buy recommendation.</p>
          <a href="/app/saved">Your watchlist <ArrowUpRight aria-hidden="true" /></a>
        </div>
      </div>
    </section>
    <footer className={styles.footer}>
      <p>Attention moves. <em>Keep the evidence.</em></p>
      <a href="/app">Go deeper in the app <ArrowRight aria-hidden="true" /></a>
      <a href={MEMETIC_TOKEN_EXPLORER_URL} target="_blank" rel="noreferrer" title={MEMETIC_TOKEN_ADDRESS} className={styles.domain}>$MS · {MEMETIC_TOKEN_ADDRESS.slice(0, 6)}…{MEMETIC_TOKEN_ADDRESS.slice(-4)}</a>
    </footer>
  </main>;
}
