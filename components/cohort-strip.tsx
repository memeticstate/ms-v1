"use client";

import { useEffect, useRef, useState, type CSSProperties } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import type { PonsPairCohort } from "@/lib/pons/model";
import { quoteAssetLabel } from "@/lib/pons/quote-label";

export function CohortStrip({ cohorts, activePair, onPair }: {
  cohorts: PonsPairCohort[]; activePair: string; onPair: (pair: string) => void;
}) {
  const strip = useRef<HTMLDivElement>(null);
  const [expanded, setExpanded] = useState(false);
  const [edges, setEdges] = useState({ start: true, end: false });
  const ordered = [...cohorts].sort((a, b) => a.symbol === "NVDA" ? -1 : b.symbol === "NVDA" ? 1 : b.attentionScore - a.attentionScore);
  const measure = () => {
    const el = strip.current;
    if (el) setEdges({ start: el.scrollLeft <= 1, end: el.scrollLeft + el.clientWidth >= el.scrollWidth - 2 });
  };
  useEffect(() => {
    measure();
    const el = strip.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [cohorts.length, expanded]);
  const previousPair = useRef(activePair);
  useEffect(() => { if (previousPair.current === activePair) return; previousPair.current = activePair; strip.current?.querySelector<HTMLElement>('[aria-pressed="true"]')?.scrollIntoView({ block: "nearest", inline: "nearest" }); }, [activePair]);
  const move = (direction: number) => strip.current?.scrollBy({ left: direction * Math.max(200, strip.current.clientWidth * 0.7), behavior: "smooth" });
  return <section className="mb-3 min-w-0 rounded-2xl border border-foreground/10 bg-[var(--surface-1)]/75 p-2" aria-label="Quote asset filters">
    <div className="mb-2 flex flex-wrap items-center justify-between gap-2 px-1">
      <span className="text-xs text-muted-foreground">{cohorts.length} quote assets observed in this window</span>
      <div className="flex items-center gap-2">
        <button type="button" onClick={() => setExpanded(value => !value)} className="min-h-9 rounded-lg border border-foreground/15 px-3 text-xs" aria-expanded={expanded}>{expanded ? "Collapse assets" : "Show all assets"}</button>
        {!expanded ? <>
          <button type="button" aria-label="Previous quote assets" disabled={edges.start} onClick={() => move(-1)} className="rounded-lg border border-foreground/15 p-2 disabled:opacity-30"><ChevronLeft size={20} /></button>
          <button type="button" aria-label="Next quote assets" disabled={edges.end} onClick={() => move(1)} className="rounded-lg border border-foreground/15 p-2 disabled:opacity-30"><ChevronRight size={20} /></button>
        </> : null}
      </div>
    </div>
    <div ref={strip} onScroll={measure} role="group" aria-label="Filter by quote asset"
      className={expanded ? "grid grid-cols-1 gap-1.5 sm:grid-cols-2 lg:grid-cols-4" : "flex gap-1.5 overflow-x-auto pb-2 [scrollbar-width:thin]"}
      onKeyDown={event => {
        if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
        const buttons = [...event.currentTarget.querySelectorAll<HTMLButtonElement>("button")];
        const current = buttons.indexOf(document.activeElement as HTMLButtonElement);
        if (current < 0) return;
        event.preventDefault();
        const next = event.key === "Home" ? 0 : event.key === "End" ? buttons.length - 1 : Math.max(0, Math.min(buttons.length - 1, current + (event.key === "ArrowRight" ? 1 : -1)));
        buttons[next]?.focus();
      }}>
      <button type="button" onClick={() => onPair("ALL")} aria-pressed={activePair === "ALL"} className={`cohort-pill ${activePair === "ALL" ? "cohort-pill-active" : ""}`}><span>All PONS</span><small>{cohorts.length} quote assets</small></button>
      {ordered.map(cohort => <button type="button" key={`${cohort.symbol}:${cohort.address}`} onClick={() => onPair(cohort.symbol)} aria-pressed={activePair === cohort.symbol}
        style={{ "--cohort-color": cohort.color } as CSSProperties}
        className={`cohort-pill ${activePair === cohort.symbol ? "cohort-pill-active" : ""}`}>
        <span className="flex items-center gap-1.5"><i className="size-1.5 rounded-full" style={{ backgroundColor: cohort.color }} />{quoteAssetLabel(cohort.symbol)}{cohort.symbol === "NVDA" ? <em>flagship</em> : null}</span>
        <small>{cohort.recentTrades} recent trades · {cohort.signal}</small>
      </button>)}
    </div>
  </section>;
}
