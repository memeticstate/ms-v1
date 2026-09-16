"use client";
import { quoteAssetLabel } from "@/lib/pons/quote-label";
import { useEffect, useState } from "react";
import { ArrowUpRight, Radio, RefreshCw } from "lucide-react";
import { TokenLabel, CopyContract } from "./token-identity";
import { TokenAvatar } from "@/components/token-avatar";
import { Button } from "@/components/ui/button";
import { factoryFeedFresh } from "@/lib/pons/factory-feed";
import type { PonsStateResponse, PonsTapeEvent } from "@/lib/pons/model";
import type { FactoryStream } from "@/components/use-factory-stream";

const integer = new Intl.NumberFormat("en-US");
const colors: Record<PonsTapeEvent["eventType"], string> = { launch: "var(--attention)", graduation: "var(--signal)", sweep: "var(--culture)", "permanent-lock": "var(--signal)" };
const labels: Record<PonsTapeEvent["eventType"], string> = { launch: "New launch", graduation: "Graduated", sweep: "Curve complete", "permanent-lock": "Permanently locked" };
const age = (value: string | number, now: number) => {
  const seconds = Math.max(0, Math.floor((now - (typeof value === "number" ? value : Date.parse(value))) / 1000));
  return seconds < 60 ? `${seconds}s ago` : seconds < 3600 ? `${Math.floor(seconds / 60)}m ago` : seconds < 86400 ? `${Math.floor(seconds / 3600)}h ago` : `${Math.floor(seconds / 86400)}d ago`;
};
export function FactoryActivity({ state, stream, onInspect, expanded = false }: {
  state?: PonsStateResponse | null; stream: FactoryStream; onInspect: (event: PonsTapeEvent) => void; expanded?: boolean;
}) {
  const [kind, setKind] = useState<PonsTapeEvent["eventType"] | "all">("all");
  const [ascending, setAscending] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => { if (document.visibilityState === "visible") setNow(Date.now()); }, 1000);
    return () => window.clearInterval(timer);
  }, []);
  const feed = stream.feed;
  const fresh = factoryFeedFresh(feed, now) && !stream.error;
  const events = [...(feed?.events ?? [])].filter((event) => kind === "all" || event.eventType === kind)
    .sort((a, b) => (ascending ? 1 : -1) * (a.blockNumber - b.blockNumber) || a.id.localeCompare(b.id)).slice(0, expanded ? 150 : 6);
  return <section className="mb-3 overflow-hidden rounded-2xl border border-signal/20 bg-[var(--surface-1)]">
    <div className="flex flex-wrap items-center justify-between gap-3 border-b border-foreground/10 px-4 py-3 sm:px-5">
      <div>
        <p className={`flex items-center gap-2 font-mono text-[9px] uppercase tracking-[0.17em] ${fresh ? "text-signal" : "text-attention"}`}><Radio className="size-3.5" />{stream.paused ? "Updates paused" : fresh ? "Live factory feed" : "Factory feed · catching up"}<span className="text-foreground/20">/</span><span className="text-muted-foreground">Auto refresh · 5s</span></p>
        <h2 className="specimen-serif mt-1.5 text-2xl tracking-[-0.025em] text-foreground">The latest on-chain arrivals.</h2>
        <p className="mt-1 text-[11px] leading-5 text-muted-foreground">Confirmed launches, graduations and locks. Trading history is reconstructed separately.</p>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <span role="status" className={`mr-1 text-[10px] ${stream.newIds.length ? "font-semibold text-signal" : "text-muted-foreground"}`}>{stream.newIds.length ? `+${stream.newIds.length} new event${stream.newIds.length === 1 ? "" : "s"}` : stream.paused ? "Resumes when you return" : stream.error ? "Retrying connection…" : stream.checking ? "Checking for arrivals…" : stream.checkedAt ? `Synced ${age(stream.checkedAt, now)}` : "Connecting…"}</span>
        <select aria-label="Filter factory changes" value={kind} onChange={(event) => setKind(event.target.value as typeof kind)} className="h-8 rounded border border-foreground/15 bg-background px-2 text-[11px]"><option value="all">All changes</option><option value="launch">Launches</option><option value="graduation">Graduations</option><option value="sweep">Completed</option><option value="permanent-lock">Locked</option></select>
        <Button variant="outline" size="sm" className="h-8 text-[11px]" onClick={() => setAscending(!ascending)}>{ascending ? "Oldest ↑" : "Newest ↓"}</Button>
        <button type="button" onClick={stream.refresh} aria-label="Refresh live factory feed" disabled={stream.checking} className="rounded border border-foreground/15 p-2 text-muted-foreground hover:text-signal"><RefreshCw className={`size-3 ${stream.checking ? "animate-spin" : ""}`} /></button>
      </div>
    </div>
    {events.length ? <div className="grid sm:grid-cols-2 xl:grid-cols-3">{events.map((event) => <article key={event.id} className={`group relative min-w-0 border-b border-r border-foreground/[0.07] px-4 py-3.5 text-left transition hover:bg-foreground/[0.035] focus-visible:outline-2 focus-visible:outline-signal sm:px-5 ${stream.newIds.includes(event.id) ? "factory-event-new" : ""}`}>
      <button type="button" onClick={() => onInspect(event)} aria-label="Inspect token evidence" className="absolute inset-0 z-10 rounded focus-visible:outline-2 focus-visible:outline-signal" />
      <div className="flex items-center justify-between gap-3"><span className="flex items-center gap-1.5 font-mono text-[9px] uppercase tracking-[0.08em]" style={{ color: colors[event.eventType] }}><span className="size-1 rounded-full bg-current" />{labels[event.eventType]}{stream.newIds.includes(event.id) ? <strong className="ml-1 text-[8px]">NEW</strong> : null}</span><span className="font-mono text-[9px] text-muted-foreground">{age(event.observedAt, now)}</span></div>
      <div className="mt-2 flex items-center gap-2"><TokenAvatar token={{ tokenAddress: event.tokenAddress, symbol: event.tokenSymbol, name: event.tokenName ?? null }} className="grid size-9 shrink-0 place-items-center overflow-hidden rounded-xl border border-foreground/10 bg-[var(--surface-3)] text-xs font-semibold" /><TokenLabel token={{ tokenAddress: event.tokenAddress, symbol: event.tokenSymbol, name: event.tokenName ?? null }} className="flex-1 text-base" /><span className="text-[10px] text-muted-foreground">{event.pairSymbol !== "—" ? `/ ${quoteAssetLabel(event.pairSymbol)}` : ""}</span><ArrowUpRight className="ml-auto size-3.5 shrink-0 text-muted-foreground transition group-hover:text-signal" /></div>
      <p className="mt-1.5 font-mono text-[9px] tracking-[0.04em] text-muted-foreground/80">BLOCK #{integer.format(event.blockNumber)}<span className="mx-2 text-foreground/20">/</span>Inspect evidence</p>
      <div className="mt-2"><CopyContract address={event.tokenAddress} /></div>
    </article>)}</div> : <p className="p-5 text-xs text-muted-foreground">{feed?.indexedBlock ? "No matching events in the retained feed. New confirmed events appear automatically." : "Waiting for a successful factory collection. Confirmed events will appear here automatically."}</p>}
    <div className="flex flex-wrap justify-between gap-2 px-4 py-2.5 font-mono text-[9px] text-muted-foreground sm:px-5">
      <span>{feed?.indexedBlock ? `Factory #${integer.format(feed.indexedBlock)} · ${integer.format(Math.max(0, feed.headBlock - feed.indexedBlock))} blocks from observed head · chain observed ${age(feed.observedAt, now)}` : "The last confirmed chain position will appear here."}{feed?.lastError ? " · Collection retrying" : !fresh && feed?.indexedBlock ? " · Delayed" : ""}</span>
      <span>{events.length} of {feed?.events.length ?? 0} retained events{feed?.fromBlock ? ` · recent coverage from #${integer.format(feed.fromBlock)}` : ""}{state ? ` · historical trade index #${integer.format(state.index.latestIndexedBlock)}` : ""}</span>
    </div>
  </section>;
}
