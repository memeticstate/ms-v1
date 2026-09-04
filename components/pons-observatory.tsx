"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Activity,
  ArrowDownRight,
  ArrowUpRight,
  BarChart3,
  BellRing,
  Blocks,
  Bookmark,
  BookmarkCheck,
  CheckCircle2,
  CircleDot,
  Clock3,
  Copy,
  Database,
  Download,
  ExternalLink,
  Fingerprint,
  Gauge,
  GitBranch,
  History,
  ImageDown,
  LoaderCircle,
  Megaphone,
  Network,
  Orbit,
  RadioTower,
  RefreshCw,
  ScanLine,
  Search,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  Sun,
  TimerReset,
  Users,
  Moon,
} from "lucide-react";
import { useTheme } from "next-themes";

import { StateGlyph } from "@/components/state-glyph";
import { ResearchPassport } from "@/components/research-passport";
import { PremiumInterpretationPanel } from "@/components/premium-interpretation";
import { WatchlistPanel } from "@/components/watchlist-panel";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type {
  PonsActivitySignal,
  PonsLaunchView,
  PonsPairCohort,
  PonsPulseMetric,
  PonsStateResponse,
  PonsTapeEvent,
} from "@/lib/pons/model";
import type { PassportResponse } from "@/lib/entitlements/client";
import { downloadPulseCard } from "@/lib/pons/pulse-card";
import {
  PONS_V1_CURRENT_FACTORY,
  PONS_V1_CURRENT_START_BLOCK,
  PONS_V1_LEGACY_FACTORY,
  PONS_V1_LEGACY_START_BLOCK,
} from "@/lib/pons/constants";
import { DEFAULT_PONS_STATE_WINDOW, PONS_STATE_WINDOWS } from "@/lib/pons/signals";
import {
  createWatchEntry,
  parseWatchlist,
  reconcileWatchlist,
  WATCHLIST_STORAGE_KEY,
  type WatchEntry,
  type WatchRules,
} from "@/lib/pons/watchlist";

const compact = new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 });
const integer = new Intl.NumberFormat("en-US");

function short(address: string) {
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

function relativeTime(value: string) {
  const seconds = Math.max(0, Math.round((Date.now() - new Date(value).getTime()) / 1_000));
  if (seconds < 60) return `${seconds}s ago`;
  if (seconds < 3_600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86_400) return `${Math.floor(seconds / 3_600)}h ago`;
  return `${Math.floor(seconds / 86_400)}d ago`;
}

function scoreTone(score: number) {
  if (score >= 75) return "var(--signal)";
  if (score >= 50) return "var(--signal)";
  if (score >= 25) return "var(--culture)";
  return "var(--slate)";
}

function modeTone(mode?: PonsStateResponse["mode"]) {
  return mode === "live" ? "var(--signal)" : mode === "degraded" ? "var(--danger)" : "var(--culture)";
}

const signalMeta: Record<PonsActivitySignal, { label: string; color: string; description: string }> = {
  surging: { label: "Surging", color: "var(--signal)", description: "Trade activity and participation accelerated together." },
  broadening: { label: "Broadening", color: "var(--signal)", description: "Recent activity is distributed across several actors." },
  forming: { label: "Forming", color: "var(--attention)", description: "Activity appeared after an inactive comparison window." },
  steady: { label: "Steady", color: "var(--attention)", description: "Activity held without a decisive short-horizon break." },
  cooling: { label: "Cooling", color: "var(--culture)", description: "Recent trade frequency fell against the prior window." },
  quiet: { label: "Quiet", color: "var(--slate)", description: "No curve trades were observed in the latest pulse window." },
};

function momentumLabel(value: number | null, current: number, previous: number) {
  if (value === null) return current > 0 && previous === 0 ? "new" : "—";
  if (value > 0) return `+${value}%`;
  return `${value}%`;
}

function windowLabel(blocks: number) {
  const hours = blocks / 36_000;
  return hours < 1 ? `~${Math.round(hours * 60)}m` : `~${hours.toFixed(hours >= 10 ? 0 : 1)}h`;
}

function clampUi(value: number, minimum = 0, maximum = 100) {
  return Math.max(minimum, Math.min(maximum, value));
}

function SignalBadge({ signal, compact = false }: { signal: PonsActivitySignal; compact?: boolean }) {
  const meta = signalMeta[signal];
  return (
    <span className="inline-flex items-center gap-1.5 rounded border px-2 py-1 font-mono text-[7px] uppercase tracking-[0.12em]"
      title={meta.description}
      style={{ color: meta.color, borderColor: `color-mix(in srgb, ${meta.color} 30%, transparent)`, backgroundColor: `color-mix(in srgb, ${meta.color} 7%, transparent)` }}>
      <i className="size-1 rounded-full bg-current" />{compact ? meta.label.slice(0, 5) : meta.label}
    </span>
  );
}

function Momentum({ value, current, previous }: { value: number | null; current: number; previous: number }) {
  const rising = value === null ? current > 0 : value > 0;
  const falling = value !== null && value < 0;
  const Icon = falling ? ArrowDownRight : ArrowUpRight;
  return (
    <span className="inline-flex items-center gap-1 font-mono text-[8px]"
      style={{ color: rising ? "var(--signal)" : falling ? "var(--culture)" : "var(--slate)" }}>
      {(rising || falling) ? <Icon className="size-3" /> : null}{momentumLabel(value, current, previous)}
    </span>
  );
}

function EmptyEngine({ error, onWake, wakeState }: {
  error: string | null;
  onWake: () => void;
  wakeState: "idle" | "sending" | "accepted" | "failed";
}) {
  return (
    <section className="pons-empty relative overflow-hidden border border-foreground/10 bg-[var(--surface-2)]/90 px-5 py-20 text-center sm:px-10">
      <div className="mx-auto grid size-20 place-items-center rounded-full border border-signal/20 bg-signal/5">
        {wakeState === "sending" ? <LoaderCircle className="size-8 animate-spin text-signal" /> : <Orbit className="size-8 text-signal" />}
      </div>
      <p className="mt-6 font-mono text-[9px] uppercase tracking-[0.24em] text-signal">Canonical index warming</p>
      <h2 className="specimen-serif mx-auto mt-3 max-w-2xl text-4xl tracking-[-0.035em] text-foreground/90 sm:text-5xl">
        The factory is connected. The first verified activity window is being reconstructed.
      </h2>
      <p className="mx-auto mt-4 max-w-xl text-sm leading-7 text-foreground/40">
        No synthetic launches are shown. Recent PONS V2 events will appear after they have been decoded, linked to their curves, and committed to the evidence archive.
      </p>
      {error ? <p className="mx-auto mt-4 max-w-lg font-mono text-[9px] text-danger/75">{error}</p> : null}
      <button type="button" onClick={onWake} disabled={wakeState === "sending"}
        className="mt-7 inline-flex items-center gap-2 rounded border border-signal/30 bg-signal/8 px-4 py-2.5 font-mono text-[9px] uppercase tracking-[0.16em] text-signal transition hover:bg-signal/12 disabled:opacity-50">
        <RefreshCw className={`size-3.5 ${wakeState === "sending" ? "animate-spin" : ""}`} />
        {wakeState === "accepted" ? "Indexer dispatched" : wakeState === "failed" ? "Retry indexer" : "Run indexer now"}
      </button>
    </section>
  );
}

function IntegrityRail({ state }: { state: PonsStateResponse }) {
  const cells = [
    { icon: Sparkles, label: "Launches", value: compact.format(state.summary.launches), tone: "var(--attention)" },
    { icon: Fingerprint, label: "Creator breadth", value: compact.format(state.summary.uniqueDeployers), tone: "var(--signal)" },
    { icon: Activity, label: "Curve trades", value: compact.format(state.summary.trades), tone: "var(--attention)" },
    { icon: Orbit, label: "Graduations", value: compact.format(state.summary.graduations), tone: "var(--culture)" },
    { icon: Blocks, label: "Stock terrains", value: integer.format(state.summary.stockPairs), tone: "var(--signal)" },
    { icon: RadioTower, label: "Index lag", value: `${integer.format(state.index.liveLagBlocks)} blocks`, tone: modeTone(state.mode) },
  ];
  return (
    <section aria-label="PONS observation integrity" className="observation-rail mb-3 grid grid-cols-2 overflow-hidden rounded-[7px] border border-foreground/10 bg-[var(--surface-1)]/82 md:grid-cols-3 xl:grid-cols-6">
      {cells.map(({ icon: Icon, label, value, tone }) => (
        <div key={label} className="observation-cell">
          <Icon aria-hidden="true" className="size-3.5 shrink-0" style={{ color: tone }} />
          <div className="min-w-0"><p className="observation-label">{label}</p><p className="observation-value">{value}</p></div>
        </div>
      ))}
    </section>
  );
}

function PulseCell({ icon: Icon, label, metric, tone }: {
  icon: typeof Activity;
  label: string;
  metric: PonsPulseMetric;
  tone: string;
}) {
  const maximum = Math.max(1, metric.current, metric.previous);
  return (
    <div className="pulse-cell">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2">
          <Icon className="size-3.5" style={{ color: tone }} />
          <span className="font-mono text-[7px] uppercase tracking-[0.16em] text-foreground/32">{label}</span>
        </div>
        <Momentum value={metric.changePercent} current={metric.current} previous={metric.previous} />
      </div>
      <div className="mt-3 flex items-baseline gap-2">
        <strong className="font-mono text-2xl font-medium text-foreground/86">{integer.format(metric.current)}</strong>
        <span className="font-mono text-[7px] uppercase tracking-[0.1em] text-foreground/22">vs {integer.format(metric.previous)}</span>
      </div>
      <div className="mt-3 space-y-1">
        <div className="h-1 overflow-hidden rounded-full bg-foreground/[0.055]"><div className="h-full rounded-full" style={{ width: `${metric.current / maximum * 100}%`, backgroundColor: tone }} /></div>
        <div className="h-px overflow-hidden bg-foreground/[0.035]"><div className="h-full bg-foreground/25" style={{ width: `${metric.previous / maximum * 100}%` }} /></div>
      </div>
    </div>
  );
}

function ProtocolPulse({ state, onLeader }: { state: PonsStateResponse; onLeader: (address: string) => void }) {
  const pulse = state.pulse;
  const pulseTone = pulse.status === "verified" ? "var(--signal)" : pulse.status === "delayed" ? "var(--culture)" : "var(--slate)";
  const [briefState, setBriefState] = useState<"idle" | "copied" | "failed">("idle");
  const [cardState, setCardState] = useState<"idle" | "exporting" | "exported" | "failed">("idle");
  const copyPulse = async () => {
    const change = (metric: PonsPulseMetric) => momentumLabel(metric.changePercent, metric.current, metric.previous);
    const leader = pulse.leader ? ` Leader: ${pulse.leader.tokenSymbol}/${pulse.leader.pairSymbol} · ${pulse.leader.recentTrades} trades.` : "";
    const integrity = pulse.status === "delayed" ? ` Delayed by ${integer.format(state.index.liveLagBlocks)} blocks.` : ` ${pulse.status}.`;
    const note = `PONS State · block #${integer.format(state.index.latestIndexedBlock)}\n~${pulse.approximateMinutes}m pulse: ${integer.format(pulse.trades.current)} trades (${change(pulse.trades)}), ${integer.format(pulse.uniqueTraders.current)} actors (${change(pulse.uniqueTraders)}), ${integer.format(pulse.launches.current)} launches, ${integer.format(pulse.graduations.current)} graduations.${leader}\nData:${integrity}\nObserved activity—not asset quality.\n${window.location.href}`;
    try {
      await navigator.clipboard.writeText(note);
      setBriefState("copied");
    } catch {
      setBriefState("failed");
    }
    window.setTimeout(() => setBriefState("idle"), 1_800);
  };
  const exportCard = async () => {
    setCardState("exporting");
    try {
      await downloadPulseCard(state);
      setCardState("exported");
    } catch {
      setCardState("failed");
    }
    window.setTimeout(() => setCardState("idle"), 1_800);
  };
  return (
    <section className="signal-briefing overflow-hidden rounded-[9px] border border-foreground/10 bg-[var(--surface-1)]/86">
      <div className="grid gap-4 border-b border-foreground/10 px-4 py-4 lg:grid-cols-[1fr_auto] lg:items-end">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-mono text-[9px] uppercase tracking-[0.22em]" style={{ color: pulseTone }}>{pulse.status} protocol pulse</span>
            <span className="rounded border border-foreground/10 px-2 py-1 font-mono text-[6px] uppercase tracking-[0.12em] text-foreground/28">two adjacent {integer.format(pulse.windowBlocks)}-block intervals</span>
            <span className="rounded border px-2 py-1 font-mono text-[6px] uppercase tracking-[0.12em]" style={{
              color: state.integrity.pulseReconciled ? "var(--signal)" : "var(--danger)",
              borderColor: state.integrity.pulseReconciled ? "color-mix(in srgb, var(--signal) 28%, transparent)" : "color-mix(in srgb, var(--danger) 28%, transparent)",
              backgroundColor: state.integrity.pulseReconciled ? "color-mix(in srgb, var(--signal) 6%, transparent)" : "color-mix(in srgb, var(--danger) 6%, transparent)",
            }}>{state.integrity.pulseReconciled ? "cohort totals reconciled" : "cohort mismatch"}</span>
            {pulse.status === "delayed" ? <span className="rounded border border-culture/20 bg-culture/[0.045] px-2 py-1 font-mono text-[6px] uppercase tracking-[0.12em] text-culture">indexed edge · {integer.format(state.index.liveLagBlocks)} blocks behind</span> : null}
          </div>
          <h2 className="specimen-serif mt-2 text-3xl tracking-[-0.035em] text-foreground/90 sm:text-4xl">How did verified PONS activity change at the indexed edge?</h2>
          <p className="mt-2 text-xs text-foreground/30">Current versus prior ~{pulse.approximateMinutes}-minute interval, ending at block #{integer.format(state.index.latestIndexedBlock)}.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2 lg:justify-end">
          <Button type="button" variant="outline" size="sm" onClick={() => void exportCard()} disabled={cardState === "exporting"}
            className="border-attention/20 bg-attention/[0.035] font-mono text-[7px] uppercase tracking-[0.11em] text-attention hover:bg-attention/[0.08] hover:text-attention">
            <ImageDown />{cardState === "exporting" ? "Rendering PNG" : cardState === "exported" ? "PNG exported" : cardState === "failed" ? "Export failed" : "Export X card"}
          </Button>
          <Button type="button" variant="outline" size="sm" onClick={() => void copyPulse()}
            className="border-foreground/10 bg-foreground/[0.025] font-mono text-[7px] uppercase tracking-[0.11em] text-foreground/42 hover:bg-foreground/[0.06] hover:text-signal">
            <Copy />{briefState === "copied" ? "Pulse copied" : briefState === "failed" ? "Copy failed" : "Copy pulse"}
          </Button>
          {pulse.leader ? (
            <button type="button" onClick={() => onLeader(pulse.leader!.tokenAddress)}
              className="group rounded border border-attention/20 bg-attention/[0.045] px-3 py-2.5 text-left transition hover:border-attention/35">
              <span className="block font-mono text-[6px] uppercase tracking-[0.14em] text-foreground/25">Most active launch</span>
              <span className="mt-1 flex items-center gap-2 font-mono text-[9px] text-attention">{pulse.leader.tokenSymbol} <i className="text-foreground/22 not-italic">{pulse.leader.pairSymbol} · {pulse.leader.recentTrades} trades</i><ArrowUpRight className="size-3 transition group-hover:translate-x-0.5 group-hover:-translate-y-0.5" /></span>
            </button>
          ) : <span className="font-mono text-[7px] uppercase tracking-[0.12em] text-foreground/20">Pulse warming</span>}
        </div>
      </div>
      <div className="grid md:grid-cols-2 xl:grid-cols-4">
        <PulseCell icon={Activity} label="Curve trades" metric={pulse.trades} tone="var(--attention)" />
        <PulseCell icon={Users} label="Distinct actors" metric={pulse.uniqueTraders} tone="var(--signal)" />
        <PulseCell icon={Sparkles} label="New launches" metric={pulse.launches} tone="var(--attention)" />
        <PulseCell icon={Orbit} label="Graduations" metric={pulse.graduations} tone="var(--culture)" />
      </div>
    </section>
  );
}

function memoryDelta(value: number | null) {
  if (value === null) return "warming";
  if (value > 0) return `+${value}%`;
  return `${value}%`;
}

function StateMemoryPanel({ state }: { state: PonsStateResponse }) {
  const ready = state.memory.horizons.filter((horizon) => horizon.status === "ready").length;
  return (
    <section className="state-memory mt-3 overflow-hidden rounded-[9px] border border-foreground/10 bg-[var(--surface-depth)]/88">
      <div className="flex flex-wrap items-start justify-between gap-4 border-b border-foreground/10 px-4 py-4 sm:px-5">
        <div className="flex gap-3">
          <span className="mt-0.5 grid size-8 place-items-center rounded border border-culture/20 bg-culture/[0.045] text-culture"><History className="size-4" /></span>
          <div>
            <p className="font-mono text-[9px] uppercase tracking-[0.22em] text-culture">State Memory</p>
            <h3 className="specimen-serif mt-1 text-2xl tracking-[-0.025em] text-foreground/86">Is the market merely loud—or outside its own recent character?</h3>
            <p className="mt-1 max-w-3xl text-xs leading-5 text-foreground/32">Each stratum compares the same {integer.format(state.memory.observationWindowBlocks)}-block observation window now with its durable state at that horizon.</p>
          </div>
        </div>
        <span className="rounded border border-foreground/10 bg-foreground/[0.025] px-2.5 py-1.5 font-mono text-[7px] uppercase tracking-[0.11em] text-foreground/36">{ready}/5 horizons resolved · through #{integer.format(state.memory.currentThroughBlock)}</span>
      </div>
      <div className="grid gap-px bg-foreground/10 sm:grid-cols-2 xl:grid-cols-5">
        {state.memory.horizons.map((horizon, index) => {
          const maximum = Math.max(1, horizon.trades.current, horizon.trades.baseline ?? 0);
          const rising = (horizon.trades.changePercent ?? 0) > 0;
          const falling = (horizon.trades.changePercent ?? 0) < 0;
          const tone = horizon.status === "warming" ? "var(--slate)" : rising ? "var(--signal)" : falling ? "var(--culture)" : "var(--attention)";
          return (
            <article key={horizon.id} className="memory-stratum relative bg-[var(--surface-2)] p-4">
              <span aria-hidden="true" className="absolute inset-y-0 left-0 w-px opacity-60" style={{ backgroundColor: tone }} />
              <div className="flex items-center justify-between gap-3">
                <div><span className="font-mono text-[7px] uppercase tracking-[0.16em] text-foreground/24">Stratum {String(index + 1).padStart(2, "0")}</span><h4 className="mt-1 font-mono text-sm text-foreground/78">{horizon.id}</h4></div>
                <span className="font-mono text-[8px]" style={{ color: tone }}>{memoryDelta(horizon.trades.changePercent)}</span>
              </div>
              {horizon.status === "ready" ? (
                <>
                  <div className="mt-4 flex items-end justify-between gap-3"><div><p className="font-mono text-[7px] uppercase tracking-[0.1em] text-foreground/23">Curve trades</p><p className="mt-1 font-mono text-xl text-foreground/84">{integer.format(horizon.trades.current)}</p></div><p className="text-right font-mono text-[7px] uppercase leading-4 tracking-[0.08em] text-foreground/25">then<br /><strong className="text-[10px] text-foreground/52">{integer.format(horizon.trades.baseline ?? 0)}</strong></p></div>
                  <div className="mt-3 space-y-1"><div className="h-1 overflow-hidden rounded bg-foreground/[0.055]"><span className="block h-full rounded" style={{ width: `${horizon.trades.current / maximum * 100}%`, backgroundColor: tone }} /></div><div className="h-px overflow-hidden bg-foreground/[0.035]"><span className="block h-full bg-foreground/28" style={{ width: `${(horizon.trades.baseline ?? 0) / maximum * 100}%` }} /></div></div>
                  <dl className="mt-4 grid grid-cols-2 gap-2 border-t border-foreground/[0.07] pt-3 font-mono"><div><dt className="text-[6px] uppercase tracking-[0.1em] text-foreground/20">Actors</dt><dd className="mt-1 text-[9px] text-foreground/60">{integer.format(horizon.activeTraders.current)} <span className="text-foreground/22">/ {integer.format(horizon.activeTraders.baseline ?? 0)}</span></dd></div><div><dt className="text-[6px] uppercase tracking-[0.1em] text-foreground/20">Launches</dt><dd className="mt-1 text-[9px] text-foreground/60">{integer.format(horizon.launches.current)} <span className="text-foreground/22">/ {integer.format(horizon.launches.baseline ?? 0)}</span></dd></div></dl>
                  <p className="mt-3 min-h-8 border-t border-foreground/[0.07] pt-3 font-mono text-[7px] uppercase leading-4 tracking-[0.08em] text-foreground/25">Leader {horizon.leader.changed ? <span className="text-culture">migrated {horizon.leader.baseline} → {horizon.leader.current}</span> : <span className="text-attention">held at {horizon.leader.current ?? "—"}</span>}</p>
                </>
              ) : (
                <div className="mt-4 grid min-h-[145px] place-items-center rounded border border-dashed border-foreground/10 bg-foreground/[0.018] px-3 text-center"><p className="font-mono text-[7px] uppercase leading-4 tracking-[0.1em] text-foreground/24">Accumulating a trustworthy<br />{horizon.label} baseline</p></div>
              )}
            </article>
          );
        })}
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-foreground/10 px-4 py-3 font-mono text-[6px] uppercase tracking-[0.1em] text-foreground/20 sm:px-5"><span>Current / historical snapshot · activity state, not price forecast</span><span>Missing horizons stay visibly warming</span></div>
    </section>
  );
}

function ProtocolCoveragePanel({ state }: { state: PonsStateResponse }) {
  const coverage = state.protocolCoverage ?? {
    canonicalGenerations: 3,
    deeplyIndexedGenerations: 1,
    rankingScope: "PONS V2 bonding-curve activity only",
    generations: [
      { id: "v2" as const, label: "V2 · Bonding curve", mechanism: "Curve → locked V4 pool", factory: state.index.factory, startBlock: state.index.backfillFloor, status: "deep" as const, dataDepth: "Launches, curve trades, actors, graduations and locks", indexedThroughBlock: state.index.latestIndexedBlock, historicalProgress: state.index.historicalProgress, rankingEligible: true },
      { id: "v1-current" as const, label: "V1 · Current", mechanism: "Uniswap V3 from block one", factory: PONS_V1_CURRENT_FACTORY, startBlock: PONS_V1_CURRENT_START_BLOCK, status: "registry" as const, dataDepth: "Canonical factory verified; launch and swap reconstruction queued", indexedThroughBlock: null, historicalProgress: 0, rankingEligible: false },
      { id: "v1-legacy" as const, label: "V1 · Legacy", mechanism: "Uniswap V3 from block one", factory: PONS_V1_LEGACY_FACTORY, startBlock: PONS_V1_LEGACY_START_BLOCK, status: "queued" as const, dataDepth: "Canonical archive boundary verified; historical reconstruction queued", indexedThroughBlock: null, historicalProgress: 0, rankingEligible: false },
    ],
  };
  return (
    <section className="mt-3 overflow-hidden rounded-[9px] border border-foreground/10 bg-[var(--surface-1)]/84">
      <div className="flex flex-wrap items-start justify-between gap-4 border-b border-foreground/10 px-4 py-4 sm:px-5">
        <div className="flex gap-3">
          <span className="mt-0.5 grid size-8 place-items-center rounded border border-attention/20 bg-attention/[0.045] text-attention"><GitBranch className="size-4" /></span>
          <div>
            <p className="font-mono text-[9px] uppercase tracking-[0.22em] text-attention">Protocol coverage map</p>
            <h3 className="specimen-serif mt-1 text-2xl tracking-[-0.025em] text-foreground/86">One PONS history, three canonical generations.</h3>
            <p className="mt-1 max-w-3xl text-xs leading-5 text-foreground/32">Memetic State keeps generations separate until their evidence is comparable. Rankings currently use deep V2 lifecycle data; V1 factories are verified boundaries, not invented activity.</p>
          </div>
        </div>
        <span className="rounded border border-foreground/10 bg-foreground/[0.025] px-2.5 py-1.5 font-mono text-[7px] uppercase tracking-[0.11em] text-foreground/36">{coverage.deeplyIndexedGenerations}/{coverage.canonicalGenerations} generations deep</span>
      </div>
      <div className="grid gap-px bg-foreground/10 lg:grid-cols-3">
        {coverage.generations.map((generation) => {
          const tone = generation.status === "deep" || generation.status === "complete"
            ? "var(--signal)"
            : generation.status === "registry" || generation.status === "indexing"
              ? "var(--attention)"
              : "var(--culture)";
          const launchProgress = generation.launchProgress ?? generation.historicalProgress;
          const swapProgress = generation.swapProgress ?? generation.historicalProgress;
          return (
            <article key={generation.id} className="relative bg-[var(--surface-2)] p-4 sm:p-5">
              <span className="absolute inset-y-0 left-0 w-px" style={{ backgroundColor: tone }} />
              <div className="flex items-start justify-between gap-3"><div><p className="font-mono text-[7px] uppercase tracking-[0.14em] text-foreground/24">{generation.mechanism}</p><h4 className="mt-1 text-sm font-medium text-foreground/78">{generation.label}</h4></div><span className="rounded border px-2 py-1 font-mono text-[6px] uppercase tracking-[0.11em]" style={{ color: tone, borderColor: `color-mix(in srgb, ${tone} 28%, transparent)`, backgroundColor: `color-mix(in srgb, ${tone} 6%, transparent)` }}>{generation.status}</span></div>
              <p className="mt-4 min-h-10 text-[11px] leading-5 text-foreground/34">{generation.dataDepth}</p>
              <div className="mt-4 space-y-2.5">
                <div><div className="mb-1 flex items-center justify-between font-mono text-[6px] uppercase tracking-[0.1em] text-foreground/22"><span>Launch registry</span><span>{launchProgress.toFixed(1)}%</span></div><div className="h-1 overflow-hidden rounded bg-foreground/[0.055]"><span className="block h-full rounded" style={{ width: `${clampUi(launchProgress)}%`, backgroundColor: tone }} /></div></div>
                <div><div className="mb-1 flex items-center justify-between font-mono text-[6px] uppercase tracking-[0.1em] text-foreground/22"><span>Activity reconstruction</span><span>{swapProgress.toFixed(1)}%</span></div><div className="h-1 overflow-hidden rounded bg-foreground/[0.055]"><span className="block h-full rounded opacity-70" style={{ width: `${clampUi(swapProgress)}%`, backgroundColor: tone }} /></div></div>
              </div>
              <div className="mt-3 flex items-end justify-between gap-3 font-mono"><div><p className="text-[6px] uppercase tracking-[0.1em] text-foreground/20">Evidence indexed</p><p className="mt-1 text-[10px] text-foreground/58">{integer.format(generation.launchesIndexed ?? 0)} launches · {integer.format(generation.swapsIndexed ?? 0)} swaps</p></div><a href={`https://robinhoodchain.blockscout.com/address/${generation.factory}`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-[7px] uppercase tracking-[0.08em] text-foreground/30 transition hover:text-attention">{short(generation.factory)} <ExternalLink className="size-2.5" /></a></div>
              <p className="mt-3 border-t border-foreground/[0.07] pt-3 font-mono text-[6px] uppercase tracking-[0.09em] text-foreground/20">{generation.rankingEligible ? `Ranked through #${integer.format(generation.indexedThroughBlock ?? 0)}` : `Start block #${integer.format(generation.startBlock)} · excluded from ranks`}</p>
            </article>
          );
        })}
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-foreground/10 px-4 py-3 font-mono text-[6px] uppercase tracking-[0.1em] text-foreground/22 sm:px-5"><span>Current ranking scope · {coverage.rankingScope}</span><a href="https://docs.ponsfamily.com/" target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 transition hover:text-attention">Verify against PONS docs <ExternalLink className="size-2.5" /></a></div>
    </section>
  );
}

function ProtocolHistoryPanel({ state }: { state: PonsStateResponse }) {
  const history = state.history;
  if (!history) {
    return (
      <section className="rounded-[9px] border border-foreground/10 bg-[var(--surface-1)]/84 p-8 text-center">
        <History className="mx-auto size-6 text-culture" />
        <p className="mt-4 font-mono text-[8px] uppercase tracking-[0.16em] text-culture">Historical ledger warming</p>
        <p className="mx-auto mt-2 max-w-xl text-xs leading-5 text-foreground/34">The current and legacy PONS factories are being registered. No historical launch or swap is displayed until its canonical log has been committed.</p>
      </section>
    );
  }
  return (
    <div className="space-y-3">
      <section className="overflow-hidden rounded-[9px] border border-foreground/10 bg-[var(--surface-1)]/86">
        <div className="flex flex-wrap items-start justify-between gap-4 border-b border-foreground/10 p-5 sm:p-6">
          <div><p className="font-mono text-[8px] uppercase tracking-[0.18em] text-culture">Complete PONS history</p><h2 className="specimen-serif mt-2 text-3xl tracking-[-0.03em] text-foreground/88">One archive, without flattening protocol generations.</h2><p className="mt-2 max-w-3xl text-xs leading-5 text-foreground/34">V2 curve activity and V1 Uniswap V3 activity remain mechanically distinct. Launch discovery commits first; swap history follows behind it, so coverage is measurable instead of implied.</p></div>
          <div className="grid grid-cols-2 gap-px overflow-hidden rounded border border-foreground/10 bg-foreground/10 font-mono"><div className="bg-[var(--surface-2)] px-4 py-3"><p className="text-[6px] uppercase tracking-[0.11em] text-foreground/22">V1 launches</p><p className="mt-1 text-lg text-foreground/76">{integer.format(history.launchCount)}</p></div><div className="bg-[var(--surface-2)] px-4 py-3"><p className="text-[6px] uppercase tracking-[0.11em] text-foreground/22">V1 swaps</p><p className="mt-1 text-lg text-foreground/76">{integer.format(history.swapCount)}</p></div></div>
        </div>
        <div className="grid gap-px bg-foreground/10 lg:grid-cols-2">
          {history.generations.map((generation) => {
            const healthy = generation.consecutiveFailures === 0;
            return <article key={generation.id} className="bg-[var(--surface-2)] p-5"><div className="flex items-start justify-between gap-3"><div><p className="font-mono text-[7px] uppercase tracking-[0.14em] text-attention">{generation.id === "v1-current" ? "Current V1" : "Legacy V1"}</p><p className="mt-1 text-xs text-foreground/34">Uniswap V3 launch + pool activity</p></div><span className="rounded border px-2 py-1 font-mono text-[6px] uppercase tracking-[0.1em]" style={{ color: healthy ? "var(--signal)" : "var(--danger)", borderColor: healthy ? "color-mix(in srgb, var(--signal) 25%, transparent)" : "color-mix(in srgb, var(--danger) 25%, transparent)" }}>{healthy ? "reconciled" : `${generation.consecutiveFailures} failures`}</span></div><div className="mt-5 grid grid-cols-2 gap-4"><div><div className="flex justify-between font-mono text-[6px] uppercase tracking-[0.1em] text-foreground/24"><span>Launch discovery</span><span>{generation.launchProgress.toFixed(1)}%</span></div><Progress value={generation.launchProgress} className="mt-2 h-1 bg-foreground/8 [&>div]:bg-attention" /></div><div><div className="flex justify-between font-mono text-[6px] uppercase tracking-[0.1em] text-foreground/24"><span>Swap history</span><span>{generation.swapProgress.toFixed(1)}%</span></div><Progress value={generation.swapProgress} className="mt-2 h-1 bg-foreground/8 [&>div]:bg-culture" /></div></div><div className="mt-5 flex items-center justify-between border-t border-foreground/[0.07] pt-3 font-mono text-[7px] uppercase tracking-[0.08em] text-foreground/25"><span>{integer.format(generation.launches)} launches · {integer.format(generation.swaps)} swaps</span><a href={`https://robinhoodchain.blockscout.com/address/${generation.factory}`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 hover:text-attention">factory <ExternalLink className="size-2.5" /></a></div></article>;
          })}
        </div>
      </section>
      <section className="overflow-hidden rounded-[9px] border border-foreground/10 bg-[var(--surface-2)]/86">
        <div className="flex items-center justify-between gap-4 border-b border-foreground/10 px-4 py-3 sm:px-5"><div><p className="font-mono text-[8px] uppercase tracking-[0.16em] text-foreground/44">V1 launch ledger</p><p className="mt-1 text-[10px] text-foreground/27">Most recent committed launches across both canonical factories</p></div><span className="font-mono text-[6px] uppercase tracking-[0.1em] text-foreground/20">finality {history.finalityBlocks} blocks</span></div>
        {history.recent.length ? <div className="overflow-x-auto"><table className="w-full min-w-[860px] border-collapse text-left"><thead><tr className="border-b border-foreground/[0.07] font-mono text-[6px] uppercase tracking-[0.11em] text-foreground/22">{["Generation", "Token", "Habitat", "Creator", "Pool activity", "Block", "Evidence"].map((label) => <th key={label} className="px-4 py-3 font-normal">{label}</th>)}</tr></thead><tbody>{history.recent.map((launch) => <tr key={`${launch.generation}:${launch.tokenAddress}`} className="border-b border-foreground/[0.055] text-[10px] text-foreground/42 last:border-0"><td className="px-4 py-3 font-mono text-[7px] uppercase text-culture">{launch.generation === "v1-current" ? "V1 current" : "V1 legacy"}</td><td className="px-4 py-3"><p className="font-medium text-foreground/70">{launch.symbol || short(launch.tokenAddress)}</p><p className="mt-0.5 font-mono text-[7px] text-foreground/22">{launch.name || short(launch.tokenAddress)}</p></td><td className="px-4 py-3 font-mono text-[8px] text-attention">{launch.pairSymbol}</td><td className="px-4 py-3 font-mono text-[8px]">{short(launch.deployerAddress)}</td><td className="px-4 py-3 font-mono text-[8px]">{integer.format(launch.swaps)} swaps · {integer.format(launch.uniqueTraders)} actors</td><td className="px-4 py-3 font-mono text-[8px]">#{integer.format(launch.blockNumber)}</td><td className="px-4 py-3"><a href={`https://robinhoodchain.blockscout.com/tx/${launch.txHash}`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 font-mono text-[7px] uppercase tracking-[0.08em] text-foreground/30 hover:text-attention">transaction <ExternalLink className="size-2.5" /></a></td></tr>)}</tbody></table></div> : <div className="p-10 text-center font-mono text-[7px] uppercase tracking-[0.12em] text-foreground/24">Launch discovery is running · the table remains empty until the first committed range</div>}
      </section>
    </div>
  );
}

function CohortStrip({ cohorts, activePair, onPair }: {
  cohorts: PonsPairCohort[];
  activePair: string;
  onPair: (pair: string) => void;
}) {
  const ordered = [...cohorts].sort((left, right) => {
    if (left.symbol === "NVDA") return -1;
    if (right.symbol === "NVDA") return 1;
    return right.attentionScore - left.attentionScore;
  });
  return (
    <div className="mb-3 flex gap-1.5 overflow-x-auto rounded-[7px] border border-foreground/10 bg-[var(--surface-1)]/75 p-2 [scrollbar-width:none]">
      <button type="button" onClick={() => onPair("ALL")}
        className={`cohort-pill ${activePair === "ALL" ? "cohort-pill-active" : ""}`}>
        <span>All PONS</span><small>{cohorts.length} pairs</small>
      </button>
      {ordered.map((cohort) => (
        <button type="button" key={`${cohort.symbol}:${cohort.address}`} onClick={() => onPair(cohort.symbol)}
          className={`cohort-pill ${activePair === cohort.symbol ? "cohort-pill-active" : ""}`}
          style={activePair === cohort.symbol ? { "--cohort-color": cohort.color } as React.CSSProperties : undefined}>
          <span className="flex items-center gap-1.5">
            <i className="size-1.5 rounded-full" style={{ backgroundColor: cohort.color }} />{cohort.symbol}
            {cohort.symbol === "NVDA" ? <em>flagship</em> : null}
          </span>
          <small>{cohort.recentTrades} recent trades · {signalMeta[cohort.signal].label}</small>
        </button>
      ))}
    </div>
  );
}

function launchPosition(index: number, total: number, score: number) {
  const golden = Math.PI * (3 - Math.sqrt(5));
  const ring = 118 + (index % 3) * 72 + Math.min(34, Math.floor(index / 9) * 18);
  const angle = index * golden + total * 0.07 + score * 0.003;
  return { x: 500 + Math.cos(angle) * ring, y: 320 + Math.sin(angle) * ring * 0.76 };
}

function PonsGravityField({ pair, cohort, launches, selected, onSelect }: {
  pair: string;
  cohort: PonsPairCohort | null;
  launches: PonsLaunchView[];
  selected: PonsLaunchView | null;
  onSelect: (launch: PonsLaunchView) => void;
}) {
  const visible = launches.slice(0, 20);
  const centerColor = pair === "ALL" ? "var(--signal)" : cohort?.color ?? "var(--signal)";
  return (
    <section className="pons-field relative min-h-[570px] overflow-hidden rounded-[9px] border border-foreground/10 bg-[var(--surface-depth)]/88 lg:min-h-[660px]">
      <div className="absolute inset-x-0 top-0 z-10 flex items-start justify-between gap-4 border-b border-foreground/10 bg-[var(--surface-1)]/82 px-4 py-3 backdrop-blur-md">
        <div>
          <div className="flex items-center gap-2">
            <Orbit className="size-3.5" style={{ color: centerColor }} />
            <p className="font-mono text-[9px] uppercase tracking-[0.22em]" style={{ color: centerColor }}>
              {pair === "ALL" ? "PONS protocol field" : `${pair} gravity field`}
            </p>
          </div>
          <p className="mt-1 text-xs text-foreground/38">Launches positioned by recent attention and bound to one canonical quote terrain</p>
        </div>
        <div className="text-right">
          <p className="font-mono text-[8px] uppercase tracking-[0.14em] text-foreground/25">Cohort state</p>
          <p className="mt-1 font-mono text-sm" style={{ color: centerColor }}>{cohort?.attentionScore ?? "—"}<span className="text-[9px] text-foreground/25"> / 100</span></p>
        </div>
      </div>

      <svg viewBox="0 0 1000 640" className="absolute inset-0 h-full w-full pt-14" aria-label={`Interactive map of PONS launches paired with ${pair}`}>
        <defs>
          <radialGradient id="ponsGravity" cx="50%" cy="50%">
            <stop offset="0%" stopColor={centerColor} stopOpacity="0.18" />
            <stop offset="48%" stopColor={centerColor} stopOpacity="0.035" />
            <stop offset="100%" stopColor={centerColor} stopOpacity="0" />
          </radialGradient>
          <filter id="ponsNodeGlow" x="-100%" y="-100%" width="300%" height="300%">
            <feGaussianBlur stdDeviation="7" result="blur" />
            <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
          </filter>
        </defs>
        <circle cx="500" cy="320" r="285" fill="url(#ponsGravity)" />
        <circle cx="500" cy="320" r="118" fill="none" stroke={centerColor} strokeOpacity="0.09" strokeDasharray="2 8" />
        <circle cx="500" cy="320" r="190" fill="none" stroke={centerColor} strokeOpacity="0.07" strokeDasharray="2 11" />
        <circle cx="500" cy="320" r="262" fill="none" stroke={centerColor} strokeOpacity="0.05" strokeDasharray="2 14" />

        {visible.map((launch, index) => {
          const position = launchPosition(index, visible.length, launch.attentionScore);
          const active = selected?.tokenAddress === launch.tokenAddress;
          return (
            <g key={`edge-${launch.tokenAddress}`}>
              <line x1="500" y1="320" x2={position.x} y2={position.y}
                stroke={launch.pairColor} strokeWidth={active ? 1.8 : 0.75}
                strokeOpacity={active ? 0.78 : 0.14} strokeDasharray={active ? "4 7" : "2 10"}
                className={active ? "edge-flow" : undefined} />
            </g>
          );
        })}

        <g className="gravity-core">
          <circle cx="500" cy="320" r="67" fill="var(--surface-3)" stroke={centerColor} strokeWidth="1.5" />
          <circle cx="500" cy="320" r="53" fill={centerColor} fillOpacity="0.07" stroke={centerColor} strokeOpacity="0.22" />
          <text x="500" y="316" textAnchor="middle" fill={centerColor} fontFamily="IBM Plex Mono, monospace" fontSize="21" fontWeight="800">
            {pair === "ALL" ? "PONS" : pair}
          </text>
          <text x="500" y="339" textAnchor="middle" fill="var(--slate)" fontFamily="IBM Plex Mono, monospace" fontSize="8" letterSpacing="2">
            {pair === "ALL" ? "FACTORY" : "QUOTE TERRAIN"}
          </text>
        </g>

        {visible.map((launch, index) => {
          const { x, y } = launchPosition(index, visible.length, launch.attentionScore);
          const active = selected?.tokenAddress === launch.tokenAddress;
          const radius = 14 + Math.min(14, launch.attentionScore / 7.5);
          return (
            <g key={launch.tokenAddress} role="button" tabIndex={0} aria-label={`Inspect ${launch.name}`}
              className="cursor-pointer outline-none" onClick={() => onSelect(launch)}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") { event.preventDefault(); onSelect(launch); }
              }}>
              {active ? <circle cx={x} cy={y} r={radius + 11} fill="none" stroke={launch.pairColor} strokeOpacity="0.45" strokeDasharray="3 5" className="signal-pulse" /> : null}
              <circle cx={x} cy={y} r={radius} fill="var(--surface-popover)" stroke={launch.pairColor} strokeWidth={active ? 2.4 : 1.1}
                filter={active ? "url(#ponsNodeGlow)" : undefined} />
              <circle cx={x - radius * 0.25} cy={y - radius * 0.23} r={Math.max(3, radius * 0.18)} fill={launch.pairColor} opacity={launch.phase === "graduated" ? 1 : 0.62} />
              <text x={x} y={y + 3} textAnchor="middle" fill="var(--foreground)" fontFamily="IBM Plex Mono, monospace" fontSize="8.5" fontWeight="700">
                {launch.symbol.slice(0, 8)}
              </text>
              <text x={x} y={y + radius + 13} textAnchor="middle" fill={active ? launch.pairColor : "var(--slate)"} fontFamily="IBM Plex Mono, monospace" fontSize="7.5">
                {launch.attentionScore} · {launch.trades}T
              </text>
            </g>
          );
        })}
      </svg>

      <div className="absolute inset-x-3 bottom-3 z-10 flex gap-1.5 overflow-x-auto rounded-md border border-foreground/10 bg-[var(--surface-2)]/88 p-2 backdrop-blur-md [scrollbar-width:none]">
        {visible.length ? visible.map((launch) => (
          <button type="button" key={launch.tokenAddress} onClick={() => onSelect(launch)}
            className={`shrink-0 rounded border px-2.5 py-2 text-left transition ${selected?.tokenAddress === launch.tokenAddress ? "border-foreground/25 bg-foreground/10" : "border-foreground/8 bg-foreground/[0.025] hover:border-foreground/15"}`}>
            <span className="block font-mono text-[8px] font-semibold" style={{ color: launch.pairColor }}>{launch.symbol}</span>
            <span className="mt-0.5 block font-mono text-[7px] uppercase tracking-[0.08em] text-foreground/24">{launch.uniqueTraders} actors · {launch.phase}</span>
          </button>
        )) : <p className="px-2 py-2 text-xs text-foreground/30">This pair has no decoded launch activity in the current window.</p>}
      </div>
    </section>
  );
}

function ScoreRing({ score, color }: { score: number; color: string }) {
  const circumference = 2 * Math.PI * 43;
  return (
    <div className="relative size-28 shrink-0">
      <svg viewBox="0 0 100 100" className="size-full -rotate-90">
        <circle cx="50" cy="50" r="43" fill="none" stroke="color-mix(in srgb, var(--foreground) 8%, transparent)" strokeWidth="3" />
        <circle cx="50" cy="50" r="43" fill="none" stroke={color} strokeWidth="3" strokeLinecap="round"
          strokeDasharray={circumference} strokeDashoffset={circumference * (1 - score / 100)} />
      </svg>
      <div className="absolute inset-0 grid place-items-center text-center">
        <div><span className="text-3xl font-semibold" style={{ color }}>{score}</span><p className="font-mono text-[7px] uppercase tracking-[0.14em] text-foreground/25">attention</p></div>
      </div>
    </div>
  );
}

function LaunchDossier({ launch, saved, onToggleSave }: {
  launch: PonsLaunchView | null;
  saved: boolean;
  onToggleSave: (launch: PonsLaunchView) => void;
}) {
  if (!launch) {
    return (
      <aside className="grid min-h-[420px] place-items-center rounded-[9px] border border-foreground/10 bg-[var(--surface-2)]/82 p-7 text-center">
        <div><CircleDot className="mx-auto size-7 text-foreground/20" /><p className="mt-4 font-mono text-[9px] uppercase tracking-[0.18em] text-foreground/28">Select a launch to inspect its evidence</p></div>
      </aside>
    );
  }
  const phaseColor = launch.phase === "graduated" ? "var(--signal)" : launch.phase === "swept" ? "var(--culture)" : "var(--signal)";
  const gradRate = launch.deployerLaunches ? Math.round(launch.deployerGraduations / launch.deployerLaunches * 100) : 0;
  return (
    <aside className="relative overflow-hidden rounded-[9px] border border-foreground/10 bg-[var(--surface-2)]/88 p-5 lg:p-6">
      <div className="absolute inset-x-0 top-0 h-px" style={{ background: `linear-gradient(90deg, transparent, ${launch.pairColor}, transparent)` }} />
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <SignalBadge signal={launch.signal} />
            <span className="rounded border px-2 py-1 font-mono text-[7px] uppercase tracking-[0.13em]" style={{ color: phaseColor, borderColor: `color-mix(in srgb, ${phaseColor} 34%, transparent)`, backgroundColor: `color-mix(in srgb, ${phaseColor} 7%, transparent)` }}>{launch.phase}</span>
            <span className="font-mono text-[8px] uppercase tracking-[0.14em] text-foreground/25">{launch.pairSymbol} habitat</span>
          </div>
          <h2 className="specimen-serif mt-4 truncate text-4xl tracking-[-0.035em] text-foreground/92">{launch.name}</h2>
          <p className="mt-1 font-mono text-[10px] uppercase tracking-[0.16em]" style={{ color: launch.pairColor }}>{launch.symbol}</p>
        </div>
        <ScoreRing score={launch.attentionScore} color={scoreTone(launch.attentionScore)} />
      </div>

      <Button type="button" variant="outline" size="sm" onClick={() => onToggleSave(launch)}
        className={`mt-4 w-full justify-center font-mono text-[7px] uppercase tracking-[0.11em] ${saved ? "border-signal/20 bg-signal/[0.035] text-signal hover:bg-signal/[0.06]" : "border-foreground/10 bg-foreground/[0.025] text-foreground/42 hover:border-attention/25 hover:text-attention"}`}>
        {saved ? <BookmarkCheck /> : <Bookmark />}{saved ? "Saved to research watchlist" : "Save research"}
      </Button>

      <div className="mt-5 rounded border border-foreground/10 bg-foreground/[0.025] px-3.5 py-3">
        <div className="flex items-center justify-between gap-3">
          <p className="font-mono text-[7px] uppercase tracking-[0.15em] text-foreground/26">Short-horizon read</p>
          <span className="rounded border border-foreground/8 px-1.5 py-0.5 font-mono text-[6px] uppercase tracking-[0.1em] text-foreground/24">{launch.confidence} sample confidence</span>
        </div>
        <p className="mt-2 text-xs leading-5 text-foreground/52">{launch.signalNote}</p>
      </div>

      <div className="mt-5 grid grid-cols-2 gap-px overflow-hidden rounded border border-foreground/10 bg-foreground/10">
        {[
          ["Latest pulse", `${integer.format(launch.recentTrades)} trades`],
          ["Pulse change", momentumLabel(launch.momentumPercent, launch.recentTrades, launch.previousTrades)],
          ["Recent actors", integer.format(launch.recentUniqueTraders)],
          ["Buy event share", `${launch.buyShare}%`],
          ["Window trades", integer.format(launch.trades)],
          ["Window actors", integer.format(launch.uniqueTraders)],
        ].map(([label, value]) => (
          <div key={label} className="bg-[var(--surface-3)] px-3 py-3">
            <p className="font-mono text-[7px] uppercase tracking-[0.14em] text-foreground/25">{label}</p>
            <p className="mt-1 text-lg font-semibold text-foreground/78">{value}</p>
          </div>
        ))}
      </div>

      <div className="mt-5 border-t border-foreground/10 pt-5">
        <div className="flex items-center justify-between gap-3">
          <p className="flex items-center gap-2 font-mono text-[8px] uppercase tracking-[0.16em] text-foreground/35"><GitBranch className="size-3 text-attention" />Creator lineage</p>
          <span className="font-mono text-[8px] text-foreground/22">{gradRate}% historical graduation</span>
        </div>
        <div className="mt-3 grid grid-cols-3 gap-2">
          <div className="dossier-cell"><strong>{launch.deployerLaunches}</strong><span>launches</span></div>
          <div className="dossier-cell"><strong>{launch.deployerGraduations}</strong><span>graduated</span></div>
          <div className="dossier-cell"><strong>#{integer.format(launch.blockNumber)}</strong><span>birth block</span></div>
        </div>
        <a href={`https://robinhoodchain.blockscout.com/address/${launch.deployerAddress}`} target="_blank" rel="noreferrer"
          className="mt-3 flex items-center justify-between gap-3 rounded border border-foreground/8 bg-foreground/[0.025] px-3 py-2 font-mono text-[8px] text-foreground/30 transition hover:border-foreground/15 hover:text-foreground/55">
          <span className="truncate">deployer {short(launch.deployerAddress)}</span><ExternalLink className="size-3" />
        </a>
      </div>

      <div className="mt-5 border-t border-foreground/10 pt-5">
        <p className="flex items-center gap-2 font-mono text-[8px] uppercase tracking-[0.16em] text-foreground/35"><Gauge className="size-3 text-signal" />Signal dimensions</p>
        <div className="mt-3 space-y-3">
          {[
            ["Recent velocity", Math.min(100, Math.round(Math.log2(launch.recentTrades + 1) * 20))],
            ["Recent breadth", Math.min(100, Math.round(Math.sqrt(launch.recentUniqueTraders) * 22))],
            ["Momentum", launch.momentumPercent === null ? (launch.recentTrades ? 65 : 0) : Math.round(clampUi(50 + launch.momentumPercent / 2))],
            ["Flow diversity", launch.flowQuality],
            ["Lifecycle maturity", launch.phase === "graduated" ? 100 : launch.phase === "swept" ? 70 : 30],
          ].map(([label, value]) => (
            <div key={label as string} className="grid grid-cols-[100px_1fr_28px] items-center gap-2">
              <span className="font-mono text-[7px] uppercase tracking-[0.09em] text-foreground/28">{label}</span>
              <div className="h-1 overflow-hidden rounded-full bg-foreground/8"><div className="h-full rounded-full bg-signal" style={{ width: `${value}%` }} /></div>
              <span className="text-right font-mono text-[7px] text-foreground/25">{value}</span>
            </div>
          ))}
        </div>
      </div>

      <div className="mt-5 space-y-2 border-t border-foreground/10 pt-4 font-mono text-[7px] uppercase tracking-[0.1em] text-foreground/24">
        <a href={`https://robinhoodchain.blockscout.com/address/${launch.tokenAddress}`} target="_blank" rel="noreferrer" className="flex items-center justify-between gap-3 hover:text-foreground/50"><span className="truncate">token {launch.tokenAddress}</span><ExternalLink className="size-3" /></a>
        <a href={`https://robinhoodchain.blockscout.com/address/${launch.curveAddress}`} target="_blank" rel="noreferrer" className="flex items-center justify-between gap-3 hover:text-foreground/50"><span className="truncate">curve {launch.curveAddress}</span><ExternalLink className="size-3" /></a>
        <span className="flex items-center justify-between gap-3"><span>config {launch.launchConfigId} · born {relativeTime(launch.launchedAt)}</span><ShieldCheck className="size-3 text-signal" /></span>
      </div>
    </aside>
  );
}

type SignalSort = "attention" | "pulse" | "momentum" | "actors" | "newest";
type PhaseFilter = "all" | PonsLaunchView["phase"];
type SignalFilter = "all" | "active" | PonsActivitySignal;

function csvCell(value: string | number) {
  const text = String(value);
  return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function exportSignalSnapshot(launches: PonsLaunchView[], state: PonsStateResponse) {
  const columns = [
    "snapshot_generated_at", "indexed_block", "research_window_blocks", "signal_window_blocks",
    "token_name", "token_symbol", "token_address", "pair", "phase", "signal", "confidence",
    "attention_score", "recent_trades", "previous_trades", "momentum_percent", "recent_actors",
    "buy_event_share", "window_trades", "window_actors", "deployer", "birth_block", "launch_tx",
  ];
  const rows = launches.map((launch) => [
    state.generatedAt, state.index.latestIndexedBlock, state.window.blocks, state.pulse.windowBlocks,
    launch.name, launch.symbol, launch.tokenAddress, launch.pairSymbol, launch.phase, launch.signal,
    launch.confidence, launch.attentionScore, launch.recentTrades, launch.previousTrades,
    launch.momentumPercent ?? "new", launch.recentUniqueTraders, launch.buyShare, launch.trades,
    launch.uniqueTraders, launch.deployerAddress, launch.blockNumber, launch.txHash,
  ]);
  const csv = [columns, ...rows].map((row) => row.map((value) => {
    const safe = typeof value === "string" && /^[=+\-@]/.test(value) ? `'${value}` : value;
    return csvCell(safe);
  }).join(",")).join("\n");
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `memetic-state-pons-block-${state.index.latestIndexedBlock}.csv`;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}

function SignalDesk({ launches, selected, onSelect, state, isSaved, onToggleSave }: {
  launches: PonsLaunchView[];
  selected: PonsLaunchView | null;
  onSelect: (launch: PonsLaunchView) => void;
  state: PonsStateResponse;
  isSaved: (tokenAddress: string) => boolean;
  onToggleSave: (launch: PonsLaunchView) => void;
}) {
  const [query, setQuery] = useState("");
  const [phase, setPhase] = useState<PhaseFilter>("all");
  const [signal, setSignal] = useState<SignalFilter>("all");
  const [sort, setSort] = useState<SignalSort>("attention");

  const results = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return launches
      .filter((launch) => !needle || [launch.name, launch.symbol, launch.tokenAddress, launch.deployerAddress, launch.pairSymbol]
        .some((value) => value.toLowerCase().includes(needle)))
      .filter((launch) => phase === "all" || launch.phase === phase)
      .filter((launch) => signal === "all" || (signal === "active" ? launch.recentTrades > 0 : launch.signal === signal))
      .sort((left, right) => {
        if (sort === "pulse") return right.recentTrades - left.recentTrades || right.recentUniqueTraders - left.recentUniqueTraders;
        if (sort === "momentum") return (right.recentTrades - right.previousTrades) - (left.recentTrades - left.previousTrades) || right.recentTrades - left.recentTrades;
        if (sort === "actors") return right.recentUniqueTraders - left.recentUniqueTraders || right.recentTrades - left.recentTrades;
        if (sort === "newest") return right.blockNumber - left.blockNumber;
        return right.attentionScore - left.attentionScore || right.recentTrades - left.recentTrades;
      });
  }, [launches, phase, query, signal, sort]);

  return (
    <section className="mt-3 grid gap-3 lg:grid-cols-[minmax(0,1fr)_410px] xl:grid-cols-[minmax(0,1fr)_450px]">
      <div className="min-w-0 overflow-hidden rounded-[9px] border border-foreground/10 bg-[var(--surface-1)]/86">
        <div className="border-b border-foreground/10 px-3 py-3 sm:px-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="font-mono text-[9px] uppercase tracking-[0.2em] text-signal">Signal desk</p>
              <p className="mt-1 text-xs leading-5 text-foreground/34">Rank and inspect verified curve activity. Signals describe attention—not expected returns.</p>
            </div>
            <Button type="button" variant="outline" size="sm" onClick={() => exportSignalSnapshot(results, state)} disabled={!results.length}
              className="border-foreground/10 bg-foreground/[0.025] font-mono text-[7px] uppercase tracking-[0.11em] text-foreground/45 hover:bg-foreground/[0.06] hover:text-foreground/75">
              <Download />Export {results.length}
            </Button>
          </div>
          <div className="mt-3 grid gap-2 sm:grid-cols-[minmax(190px,1fr)_140px_140px_150px]">
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-foreground/25" />
              <Input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search token, pair, address or creator"
                aria-label="Search PONS launches" className="border-foreground/10 bg-foreground/[0.025] pl-9 font-mono text-[9px] text-foreground/70 placeholder:text-foreground/20 focus-visible:border-signal/40 focus-visible:ring-signal/10" />
            </div>
            <Select value={phase} onValueChange={(value) => setPhase(value as PhaseFilter)}>
              <SelectTrigger aria-label="Filter lifecycle phase" className="w-full border-foreground/10 bg-foreground/[0.025] font-mono text-[8px] uppercase tracking-[0.08em] text-foreground/55"><SelectValue /></SelectTrigger>
              <SelectContent className="border-foreground/10 bg-[var(--surface-popover)] text-foreground/70"><SelectItem value="all">All phases</SelectItem><SelectItem value="bonding">Bonding</SelectItem><SelectItem value="graduated">Graduated</SelectItem><SelectItem value="swept">Swept</SelectItem></SelectContent>
            </Select>
            <Select value={signal} onValueChange={(value) => setSignal(value as SignalFilter)}>
              <SelectTrigger aria-label="Filter attention signal" className="w-full border-foreground/10 bg-foreground/[0.025] font-mono text-[8px] uppercase tracking-[0.08em] text-foreground/55"><SelectValue /></SelectTrigger>
              <SelectContent className="border-foreground/10 bg-[var(--surface-popover)] text-foreground/70"><SelectItem value="all">All signals</SelectItem><SelectItem value="active">Active now</SelectItem><SelectItem value="surging">Surging</SelectItem><SelectItem value="broadening">Broadening</SelectItem><SelectItem value="forming">Forming</SelectItem><SelectItem value="steady">Steady</SelectItem><SelectItem value="cooling">Cooling</SelectItem><SelectItem value="quiet">Quiet</SelectItem></SelectContent>
            </Select>
            <Select value={sort} onValueChange={(value) => setSort(value as SignalSort)}>
              <SelectTrigger aria-label="Sort PONS launches" className="w-full border-foreground/10 bg-foreground/[0.025] font-mono text-[8px] uppercase tracking-[0.08em] text-foreground/55"><SlidersHorizontal className="size-3" /><SelectValue /></SelectTrigger>
              <SelectContent className="border-foreground/10 bg-[var(--surface-popover)] text-foreground/70"><SelectItem value="attention">Attention score</SelectItem><SelectItem value="pulse">Recent trades</SelectItem><SelectItem value="momentum">Net momentum</SelectItem><SelectItem value="actors">Recent actors</SelectItem><SelectItem value="newest">Newest launch</SelectItem></SelectContent>
            </Select>
          </div>
        </div>

        {results.length ? (
          <>
            <div className="hidden overflow-x-auto md:block">
              <table className="w-full min-w-[900px] border-collapse text-left">
                <thead><tr className="font-mono text-[7px] uppercase tracking-[0.12em] text-foreground/22">
                  <th className="w-9 px-3 py-2.5 font-normal">#</th><th className="px-3 py-2.5 font-normal">Launch</th><th className="px-3 py-2.5 font-normal">Signal</th><th className="px-3 py-2.5 font-normal">Attention</th><th className="px-3 py-2.5 font-normal">Pulse</th><th className="px-3 py-2.5 font-normal">Change</th><th className="px-3 py-2.5 font-normal">Actors</th><th className="px-3 py-2.5 font-normal">Buy events</th><th className="px-3 py-2.5 font-normal">Phase</th>
                </tr></thead>
                <tbody className="divide-y divide-white/[0.055]">
                  {results.map((launch, index) => {
                    const active = selected?.tokenAddress === launch.tokenAddress;
                    return (
                      <tr key={launch.tokenAddress} tabIndex={0} aria-label={`Inspect ${launch.name}`} onClick={() => onSelect(launch)}
                        onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); onSelect(launch); } }}
                        className={`cursor-pointer outline-none transition focus-visible:bg-foreground/[0.055] ${active ? "bg-signal/[0.055]" : "hover:bg-foreground/[0.025]"}`}>
                        <td className="px-3 py-3 font-mono text-[7px] text-foreground/18">{String(index + 1).padStart(2, "0")}</td>
                        <td className="max-w-[230px] px-3 py-3"><div className="flex items-center gap-2.5"><span className="grid size-8 shrink-0 place-items-center rounded border font-mono text-[8px] font-semibold" style={{ color: launch.pairColor, borderColor: `${launch.pairColor}32`, backgroundColor: `${launch.pairColor}0b` }}>{launch.symbol.slice(0, 4)}</span><div className="min-w-0"><p className="truncate text-xs font-medium text-foreground/78">{launch.name}</p><p className="mt-1 truncate font-mono text-[7px] uppercase tracking-[0.1em] text-foreground/22">{launch.symbol} · {launch.pairSymbol}</p></div></div></td>
                        <td className="px-3 py-3"><SignalBadge signal={launch.signal} /></td>
                        <td className="px-3 py-3"><span className="font-mono text-sm font-semibold" style={{ color: scoreTone(launch.attentionScore) }}>{launch.attentionScore}</span><span className="ml-1 font-mono text-[7px] text-foreground/18">/100</span></td>
                        <td className="px-3 py-3 font-mono text-[9px] text-foreground/60">{launch.recentTrades}<span className="ml-1 text-foreground/20">/ {launch.previousTrades}</span></td>
                        <td className="px-3 py-3"><Momentum value={launch.momentumPercent} current={launch.recentTrades} previous={launch.previousTrades} /></td>
                        <td className="px-3 py-3 font-mono text-[9px] text-foreground/55">{launch.recentUniqueTraders}</td>
                        <td className="px-3 py-3 font-mono text-[9px] text-foreground/55">{launch.buyShare}%</td>
                        <td className="px-3 py-3 font-mono text-[7px] uppercase tracking-[0.1em]" style={{ color: launch.phase === "graduated" ? "var(--signal)" : launch.phase === "swept" ? "var(--culture)" : "var(--signal)" }}>{launch.phase}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <div className="divide-y divide-white/[0.06] md:hidden">
              {results.map((launch) => (
                <button type="button" key={launch.tokenAddress} onClick={() => onSelect(launch)} className={`w-full p-4 text-left ${selected?.tokenAddress === launch.tokenAddress ? "bg-signal/[0.055]" : ""}`}>
                  <div className="flex items-start justify-between gap-3"><div><p className="text-sm text-foreground/80">{launch.name}</p><p className="mt-1 font-mono text-[7px] uppercase tracking-[0.1em]" style={{ color: launch.pairColor }}>{launch.symbol} · {launch.pairSymbol}</p></div><SignalBadge signal={launch.signal} /></div>
                  <p className="mt-3 text-[11px] leading-5 text-foreground/34">{launch.signalNote}</p>
                  <div className="mt-3 grid grid-cols-4 gap-2 font-mono"><span className="text-[7px] uppercase text-foreground/20">score<strong className="mt-1 block text-[10px] text-foreground/65">{launch.attentionScore}</strong></span><span className="text-[7px] uppercase text-foreground/20">pulse<strong className="mt-1 block text-[10px] text-foreground/65">{launch.recentTrades}</strong></span><span className="text-[7px] uppercase text-foreground/20">actors<strong className="mt-1 block text-[10px] text-foreground/65">{launch.recentUniqueTraders}</strong></span><span className="text-[7px] uppercase text-foreground/20">change<strong className="mt-1 block"><Momentum value={launch.momentumPercent} current={launch.recentTrades} previous={launch.previousTrades} /></strong></span></div>
                </button>
              ))}
            </div>
          </>
        ) : (
          <div className="grid min-h-72 place-items-center px-6 py-14 text-center"><div><Search className="mx-auto size-6 text-foreground/16" /><p className="mt-3 text-sm text-foreground/42">No launches match these filters.</p><button type="button" onClick={() => { setQuery(""); setPhase("all"); setSignal("all"); }} className="mt-3 font-mono text-[8px] uppercase tracking-[0.12em] text-signal">Clear filters</button></div></div>
        )}
      </div>
      <div className="lg:sticky lg:top-20 lg:self-start"><LaunchDossier launch={selected} saved={selected ? isSaved(selected.tokenAddress) : false} onToggleSave={onToggleSave} /></div>
    </section>
  );
}

function CohortMatrix({ cohorts, onPair }: { cohorts: PonsPairCohort[]; onPair: (pair: string) => void }) {
  return (
    <section className="mt-3 overflow-hidden rounded-[9px] border border-foreground/10 bg-[var(--surface-2)]/82">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-foreground/10 px-4 py-3">
        <div><p className="font-mono text-[8px] uppercase tracking-[0.2em] text-attention">Pair ecology</p><p className="mt-1 text-xs text-foreground/34">Compare quote terrains by recent activity, participation, lifecycle maturity, and creator concentration.</p></div>
        <span className="font-mono text-[8px] uppercase tracking-[0.12em] text-foreground/22">click a terrain to isolate it</span>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[940px] border-collapse text-left">
          <thead><tr className="font-mono text-[7px] uppercase tracking-[0.13em] text-foreground/24">
            <th className="px-4 py-2.5 font-normal">Terrain</th><th className="px-3 py-2.5 font-normal">Signal</th><th className="px-3 py-2.5 font-normal">State</th><th className="px-3 py-2.5 font-normal">Recent / prior</th><th className="px-3 py-2.5 font-normal">Change</th><th className="px-3 py-2.5 font-normal">Recent actors</th><th className="px-3 py-2.5 font-normal">Launches</th><th className="px-3 py-2.5 font-normal">Graduated</th><th className="px-3 py-2.5 font-normal">Top creator</th>
          </tr></thead>
          <tbody className="divide-y divide-white/[0.055]">
            {cohorts.map((cohort) => (
              <tr key={`${cohort.symbol}:${cohort.address}`} tabIndex={0} onClick={() => onPair(cohort.symbol)} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); onPair(cohort.symbol); } }} className="cursor-pointer text-xs text-foreground/58 outline-none transition hover:bg-foreground/[0.025] focus-visible:bg-foreground/[0.04]">
                <td className="px-4 py-3"><span className="flex items-center gap-2 font-mono text-[9px] font-semibold" style={{ color: cohort.color }}><i className="size-1.5 rounded-full bg-current" />{cohort.symbol}{cohort.symbol === "NVDA" ? <em className="rounded border border-signal/20 px-1.5 py-0.5 text-[6px] not-italic tracking-[0.12em]">FLAGSHIP</em> : null}</span></td>
                <td className="px-3 py-3"><SignalBadge signal={cohort.signal} compact /></td>
                <td className="px-3 py-3"><div className="flex items-center gap-2"><strong className="w-6 font-mono text-[9px]" style={{ color: scoreTone(cohort.attentionScore) }}>{cohort.attentionScore}</strong><div className="h-1 w-20 overflow-hidden rounded bg-foreground/8"><div className="h-full rounded" style={{ width: `${cohort.attentionScore}%`, backgroundColor: scoreTone(cohort.attentionScore) }} /></div></div></td>
                <td className="px-3 py-3 font-mono text-[9px]">{integer.format(cohort.recentTrades)} <span className="text-foreground/20">/ {integer.format(cohort.previousTrades)}</span></td>
                <td className="px-3 py-3"><Momentum value={cohort.momentumPercent} current={cohort.recentTrades} previous={cohort.previousTrades} /></td>
                <td className="px-3 py-3 font-mono text-[9px]">{integer.format(cohort.recentUniqueTraders)}</td>
                <td className="px-3 py-3 font-mono text-[9px]">{integer.format(cohort.launches)}</td>
                <td className="px-3 py-3 font-mono text-[9px]">{integer.format(cohort.graduations)} <span className="text-foreground/20">· {cohort.graduationRate}%</span></td>
                <td className="px-3 py-3 font-mono text-[9px]">{cohort.topDeployerShare.toFixed(1)}%</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

const eventColor: Record<PonsTapeEvent["eventType"], string> = {
  launch: "var(--attention)", graduation: "var(--signal)", sweep: "var(--culture)", "permanent-lock": "var(--signal)",
};

function PonsTape({ events }: { events: PonsTapeEvent[] }) {
  return (
    <section className="overflow-hidden rounded-[9px] border border-foreground/10 bg-[var(--surface-1)]/86">
      <div className="grid border-b border-foreground/10 px-4 py-4 sm:grid-cols-[1fr_auto] sm:items-end">
        <div><p className="font-mono text-[9px] uppercase tracking-[0.22em] text-signal">Canonical lifecycle tape</p><h2 className="specimen-serif mt-2 text-3xl tracking-[-0.03em] text-foreground/88">Birth, completion, graduation and permanent lock.</h2></div>
        <p className="mt-2 max-w-md text-xs leading-5 text-foreground/32 sm:mt-0 sm:text-right">Routine swaps stay in launch dossiers. The tape preserves state-changing factory events.</p>
      </div>
      {events.length ? (
        <div className="divide-y divide-white/[0.06]">
          {events.map((event) => (
            <article key={event.id} className="grid gap-3 px-4 py-3.5 transition hover:bg-foreground/[0.02] sm:grid-cols-[115px_minmax(0,1fr)_140px] sm:items-center">
              <div className="flex items-center gap-2"><span className="size-1.5 rounded-full" style={{ backgroundColor: eventColor[event.eventType] }} /><span className="font-mono text-[8px] uppercase tracking-[0.14em]" style={{ color: eventColor[event.eventType] }}>{event.eventType}</span></div>
              <div className="min-w-0"><p className="truncate text-sm text-foreground/70"><strong className="font-mono text-[10px] text-foreground/90">{event.tokenSymbol}</strong> <span className="text-foreground/35">{event.detail}</span></p><p className="mt-1 truncate font-mono text-[7px] uppercase tracking-[0.1em] text-foreground/20">{event.pairSymbol} · token {short(event.tokenAddress)}</p></div>
              <a href={`https://robinhoodchain.blockscout.com/tx/${event.txHash}`} target="_blank" rel="noreferrer" className="flex items-center justify-between gap-2 font-mono text-[7px] uppercase tracking-[0.09em] text-foreground/24 hover:text-foreground/50 sm:justify-end"><span>#{integer.format(event.blockNumber)} · {relativeTime(event.observedAt)}</span><ExternalLink className="size-3" /></a>
            </article>
          ))}
        </div>
      ) : <div className="px-4 py-14 text-center text-sm text-foreground/30">No lifecycle events have reached the durable index yet.</div>}
    </section>
  );
}

function tracePoints(values: number[], width = 800, height = 84, padding = 8) {
  if (!values.length) return "";
  const minimum = Math.min(...values);
  const maximum = Math.max(...values);
  const span = Math.max(1, maximum - minimum);
  return values.map((value, index) => {
    const x = padding + (values.length === 1 ? 0 : index / (values.length - 1)) * (width - padding * 2);
    const y = padding + (1 - (value - minimum) / span) * (height - padding * 2);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(" ");
}

function catchupLabel(minutes: number | null) {
  if (minutes === null) return "Measuring";
  if (minutes < 60) return `${minutes} min`;
  if (minutes < 1_440) return `${Math.round(minutes / 6) / 10} hr`;
  return `${Math.round(minutes / 144) / 10} d`;
}

function cycleDuration(milliseconds: number | null) {
  if (milliseconds === null) return "—";
  if (milliseconds < 1_000) return `${milliseconds} ms`;
  return `${Math.round(milliseconds / 100) / 10} s`;
}

function BlockSeismograph({ state }: { state: PonsStateResponse }) {
  const samples = state.activity.slice(-24);
  const lag = samples.map((sample) => sample.lagBlocks);
  const flow = samples.map((sample) => sample.buys + sample.sells);
  const lagTrace = tracePoints(lag);
  const flowTrace = tracePoints(flow);
  const latest = samples.at(-1);
  const earliest = samples[0];
  const velocity = state.index.velocity;
  const trendTone = velocity.trend === "closing" ? "var(--signal)" : velocity.trend === "widening" ? "var(--danger)" : "var(--culture)";
  const collectorTone = state.collector.status === "failed" ? "var(--danger)" : state.collector.status === "succeeded" ? "var(--signal)" : "var(--culture)";
  const metadataRemainder = Math.max(0, 100 - state.coverage.metadataPercent);

  return (
    <section className="block-seismograph overflow-hidden rounded-[9px] border border-foreground/10 bg-[var(--surface-depth)]/92">
      <div className="flex flex-wrap items-start justify-between gap-4 border-b border-foreground/10 px-4 py-4 sm:px-5">
        <div className="flex gap-3">
          <span className="mt-0.5 grid size-8 place-items-center rounded border border-signal/20 bg-signal/[0.045] text-signal"><ScanLine className="size-4" /></span>
          <div><p className="font-mono text-[9px] uppercase tracking-[0.22em] text-signal">Collection seismograph</p><p className="mt-1 max-w-2xl text-xs leading-5 text-foreground/34">A temporal read of cursor lag, indexed activity, metadata coverage, and the most recent collection cycle.</p></div>
        </div>
        <div className="flex items-center gap-2 font-mono text-[7px] uppercase tracking-[0.11em]"><span className="rounded border border-foreground/10 bg-foreground/[0.025] px-2 py-1.5" style={{ color: trendTone }}>lag {velocity.trend}</span><span className="rounded border border-foreground/10 bg-foreground/[0.025] px-2 py-1.5" style={{ color: collectorTone }}>{state.collector.status} · {state.collector.strategy ?? state.collector.phase}</span></div>
      </div>
      <div className="grid xl:grid-cols-[minmax(0,1.55fr)_minmax(340px,.75fr)]">
        <div className="border-b border-foreground/10 p-4 sm:p-5 xl:border-b-0 xl:border-r">
          {samples.length >= 2 ? (
            <div className="seismograph-screen relative overflow-hidden rounded border border-foreground/10 bg-[var(--surface-depth)] p-3 sm:p-4">
              <div className="relative z-10 flex items-end justify-between gap-4"><div><p className="font-mono text-[7px] uppercase tracking-[0.15em] text-culture">Live-index lag contour</p><p className="mt-1 font-mono text-lg text-foreground/78">{integer.format(latest?.lagBlocks ?? state.index.liveLagBlocks)} <span className="text-[8px] uppercase tracking-[0.12em] text-foreground/24">blocks</span></p></div><p className="font-mono text-[7px] uppercase tracking-[0.1em] text-foreground/20">{integer.format(Math.max(...lag))} peak</p></div>
              <svg viewBox="0 0 800 84" preserveAspectRatio="none" className="relative z-10 mt-2 h-24 w-full" role="img" aria-label="PONS live index lag over recent collection samples">
                <defs><linearGradient id="lag-fill" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="var(--culture)" stopOpacity=".22" /><stop offset="1" stopColor="var(--culture)" stopOpacity="0" /></linearGradient></defs>
                <polygon points={`8,84 ${lagTrace} 792,84`} fill="url(#lag-fill)" />
                <polyline points={lagTrace} fill="none" stroke="var(--culture)" strokeWidth="1.5" vectorEffect="non-scaling-stroke" />
              </svg>
              <div className="relative z-10 mt-2 flex items-end justify-between gap-4 border-t border-foreground/[0.07] pt-3"><div><p className="font-mono text-[7px] uppercase tracking-[0.15em] text-signal">Observed curve flow</p><p className="mt-1 font-mono text-lg text-foreground/78">{integer.format((latest?.buys ?? 0) + (latest?.sells ?? 0))} <span className="text-[8px] uppercase tracking-[0.12em] text-foreground/24">indexed trades</span></p></div><p className="font-mono text-[7px] uppercase tracking-[0.1em] text-foreground/20">{integer.format(latest?.activeTraders ?? 0)} actors</p></div>
              <svg viewBox="0 0 800 84" preserveAspectRatio="none" className="relative z-10 mt-2 h-24 w-full" role="img" aria-label="PONS curve activity over recent collection samples">
                <defs><linearGradient id="flow-fill" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="var(--signal)" stopOpacity=".2" /><stop offset="1" stopColor="var(--signal)" stopOpacity="0" /></linearGradient></defs>
                <polygon points={`8,84 ${flowTrace} 792,84`} fill="url(#flow-fill)" />
                <polyline points={flowTrace} fill="none" stroke="var(--signal)" strokeWidth="1.5" vectorEffect="non-scaling-stroke" />
              </svg>
              <div className="relative z-10 mt-1 flex justify-between font-mono text-[6px] uppercase tracking-[0.1em] text-foreground/18"><span>{earliest ? relativeTime(earliest.observedAt) : "first sample"}</span><span>{samples.length} durable samples</span><span>now</span></div>
            </div>
          ) : (
            <div className="seismograph-screen grid min-h-[365px] place-items-center rounded border border-foreground/10 bg-[var(--surface-depth)] px-6 text-center"><div><ScanLine className="mx-auto size-7 text-signal/30" /><p className="mt-3 font-mono text-[9px] uppercase tracking-[0.16em] text-foreground/42">Telemetry warming</p><p className="mt-2 max-w-sm text-xs leading-5 text-foreground/28">Two successful collection samples are needed to calculate cursor velocity and render the temporal trace.</p></div></div>
          )}
        </div>
        <div className="p-4 sm:p-5">
          <div className="grid grid-cols-2 gap-px overflow-hidden rounded border border-foreground/10 bg-foreground/10">
            <div className="bg-[var(--surface-2)] p-3.5"><p className="font-mono text-[7px] uppercase tracking-[0.12em] text-foreground/24">Index velocity</p><p className="mt-2 font-mono text-base text-foreground/78">{velocity.indexedBlocksPerMinute === null ? "—" : compact.format(velocity.indexedBlocksPerMinute)}<span className="ml-1 text-[7px] uppercase text-foreground/22">blk/min</span></p></div>
            <div className="bg-[var(--surface-2)] p-3.5"><p className="font-mono text-[7px] uppercase tracking-[0.12em] text-foreground/24">Net closure</p><p className="mt-2 font-mono text-base" style={{ color: trendTone }}>{velocity.netCatchupPerMinute === null ? "—" : `${velocity.netCatchupPerMinute > 0 ? "+" : ""}${compact.format(velocity.netCatchupPerMinute)}`}<span className="ml-1 text-[7px] uppercase text-foreground/22">blk/min</span></p></div>
            <div className="bg-[var(--surface-2)] p-3.5"><p className="font-mono text-[7px] uppercase tracking-[0.12em] text-foreground/24">Projected live edge</p><p className="mt-2 flex items-center gap-1.5 font-mono text-base text-foreground/78"><TimerReset className="size-3.5 text-culture" />{catchupLabel(velocity.estimatedCatchupMinutes)}</p></div>
            <div className="bg-[var(--surface-2)] p-3.5"><p className="font-mono text-[7px] uppercase tracking-[0.12em] text-foreground/24">Latest cycle</p><p className="mt-2 font-mono text-base text-foreground/78">{cycleDuration(state.collector.durationMs)}</p></div>
          </div>
          <div className="mt-3 rounded border border-foreground/10 bg-foreground/[0.025] p-4">
            <div className="flex items-end justify-between gap-4"><div><p className="font-mono text-[7px] uppercase tracking-[0.14em] text-foreground/26">Identity coverage</p><p className="mt-1 text-xs text-foreground/34">Resolved token names and symbols across the committed launch set.</p></div><strong className="font-mono text-xl text-attention">{state.coverage.metadataPercent.toFixed(1)}%</strong></div>
            <div className="mt-3 flex h-1.5 overflow-hidden rounded bg-foreground/8"><span className="h-full bg-attention" style={{ width: `${state.coverage.metadataPercent}%` }} /><span className="h-full bg-culture/35" style={{ width: `${metadataRemainder}%` }} /></div>
            <div className="mt-3 grid grid-cols-3 gap-2 font-mono text-[7px] uppercase tracking-[0.08em] text-foreground/22"><span>resolved <strong className="block pt-1 text-[10px] text-foreground/65">{integer.format(state.coverage.metadataResolved)}</strong></span><span>pending <strong className="block pt-1 text-[10px] text-foreground/65">{integer.format(state.coverage.metadataPending)}</strong></span><span>failed <strong className="block pt-1 text-[10px] text-foreground/65">{integer.format(state.coverage.metadataFailed)}</strong></span></div>
          </div>
          <div className="mt-3 grid grid-cols-3 gap-2 rounded border border-foreground/10 bg-foreground/[0.018] p-3 font-mono"><span className="text-[6px] uppercase tracking-[0.1em] text-foreground/22">live blocks<strong className="mt-1 block text-[9px] text-foreground/58">{integer.format(state.collector.liveBlocksProcessed)}</strong></span><span className="text-[6px] uppercase tracking-[0.1em] text-foreground/22">archive blocks<strong className="mt-1 block text-[9px] text-foreground/58">{integer.format(state.collector.historicalBlocksProcessed)}</strong></span><span className="text-[6px] uppercase tracking-[0.1em] text-foreground/22">records<strong className="mt-1 block text-[9px] text-foreground/58">{integer.format(state.collector.recordsProcessed)}</strong></span></div>
        </div>
      </div>
    </section>
  );
}

function EvidencePanel({ state, onWake, wakeState }: {
  state: PonsStateResponse;
  onWake: () => void;
  wakeState: "idle" | "sending" | "accepted" | "failed";
}) {
  const sourceCards = [
    { icon: Network, label: "Factory", value: short(state.index.factory), note: "TokenLaunched + lifecycle events", tone: "var(--attention)" },
    { icon: RadioTower, label: "Canonical head", value: `#${integer.format(state.index.latestSeenBlock)}`, note: `${state.index.finalityBlocks}-block finality buffer`, tone: "var(--attention)" },
    { icon: Database, label: "Indexed head", value: `#${integer.format(state.index.latestIndexedBlock)}`, note: `${integer.format(state.index.liveLagBlocks)} blocks behind observation`, tone: modeTone(state.mode) },
    { icon: ShieldCheck, label: "Identity coverage", value: `${state.coverage.metadataPercent.toFixed(1)}%`, note: `${integer.format(state.coverage.metadataPending)} pending · ${integer.format(state.coverage.metadataFailed)} failed`, tone: "var(--attention)" },
  ];
  return (
    <div className="space-y-3">
      <section className="grid gap-px overflow-hidden rounded-[9px] border border-foreground/10 bg-foreground/[0.07] md:grid-cols-2 xl:grid-cols-4">
        {sourceCards.map(({ icon: Icon, label, value, note, tone }) => (
          <div key={label} className="bg-[var(--surface-2)] p-5">
            <div className="flex items-center gap-2"><Icon className="size-3.5" style={{ color: tone }} /><p className="font-mono text-[8px] uppercase tracking-[0.16em] text-foreground/30">{label}</p></div>
            <p className="mt-3 font-mono text-sm text-foreground/75">{value}</p><p className="mt-1 text-[10px] leading-4 text-foreground/27">{note}</p>
          </div>
        ))}
      </section>
      <BlockSeismograph state={state} />
      <section className="grid gap-3 lg:grid-cols-[1.1fr_.9fr]">
        <div className="rounded-[9px] border border-foreground/10 bg-[var(--surface-2)]/86 p-5">
          <div className="flex items-start justify-between gap-4"><div><p className="font-mono text-[8px] uppercase tracking-[0.18em] text-culture">Historical reconstruction</p><p className="mt-1 text-xs text-foreground/34">The live edge is collected first; immutable history advances independently behind it.</p></div><strong className="font-mono text-lg text-culture">{state.index.historicalProgress.toFixed(1)}%</strong></div>
          <Progress value={state.index.historicalProgress} className="mt-5 h-1.5 bg-foreground/8 [&>div]:bg-culture" />
          <div className="mt-3 flex items-center justify-between gap-3 font-mono text-[7px] uppercase tracking-[0.1em] text-foreground/22"><span>floor #{integer.format(state.index.backfillFloor)}</span><span>cursor #{integer.format(state.index.backfillNextBlock)}</span></div>
          <div className="mt-6 grid grid-cols-2 gap-px overflow-hidden rounded border border-foreground/10 bg-foreground/10">
            <div className="bg-[var(--surface-3)] p-3"><p className="font-mono text-[7px] uppercase tracking-[0.12em] text-foreground/24">Observation window</p><p className="mt-1 text-lg font-semibold text-foreground/75">~{state.window.approximateHours}h</p></div>
            <div className="bg-[var(--surface-3)] p-3"><p className="font-mono text-[7px] uppercase tracking-[0.12em] text-foreground/24">Score model</p><p className="mt-1 font-mono text-[10px] text-foreground/65">{state.methodology.scoreVersion}</p></div>
          </div>
        </div>
        <div className="rounded-[9px] border border-foreground/10 bg-[var(--surface-2)]/86 p-5">
          <div className="flex items-center justify-between gap-4"><p className="font-mono text-[8px] uppercase tracking-[0.18em] text-signal">Method discipline</p><button type="button" onClick={onWake} disabled={wakeState === "sending"} className="flex items-center gap-1.5 font-mono text-[7px] uppercase tracking-[0.1em] text-signal/65 hover:text-signal disabled:opacity-40"><RefreshCw className={`size-3 ${wakeState === "sending" ? "animate-spin" : ""}`} />{wakeState === "accepted" ? "dispatched" : "force cycle"}</button></div>
          <div className="mt-4 space-y-3">
            {state.methodology.caveats.map((caveat) => <p key={caveat} className="flex gap-3 text-xs leading-5 text-foreground/38"><CheckCircle2 className="mt-0.5 size-3.5 shrink-0 text-signal/60" />{caveat}</p>)}
          </div>
          <a href={`https://robinhoodchain.blockscout.com/address/${state.index.factory}`} target="_blank" rel="noreferrer" className="mt-5 flex items-center justify-between gap-3 rounded border border-foreground/8 bg-foreground/[0.025] px-3 py-2 font-mono text-[7px] uppercase tracking-[0.09em] text-foreground/26 hover:border-foreground/15 hover:text-foreground/50"><span>Inspect canonical PONS V2 factory</span><ExternalLink className="size-3" /></a>
        </div>
      </section>
    </div>
  );
}

function NetworkPanel({ state, passport, localWatchCount, windowBlocks, onOpenSignals, onOpenWatchlist, onRefreshPassport, onSyncWatches }: {
  state: PonsStateResponse;
  passport: PassportResponse | null;
  localWatchCount: number;
  windowBlocks: number;
  onOpenSignals: () => void;
  onOpenWatchlist: () => void;
  onRefreshPassport: () => Promise<void>;
  onSyncWatches: () => Promise<{ synced: number; rejected: number }>;
}) {
  const [partnerContact, setPartnerContact] = useState("");
  const [partnerPersona, setPartnerPersona] = useState("researcher");
  const [partnerWorkflow, setPartnerWorkflow] = useState("");
  const [partnerState, setPartnerState] = useState<"idle" | "sending" | "accepted" | "failed">("idle");
  const submitPartner = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setPartnerState("sending");
    try {
      const response = await fetch("/api/research-partner", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ contact: partnerContact, persona: partnerPersona, workflow: partnerWorkflow, website: "" }),
      });
      if (!response.ok) throw new Error("application rejected");
      setPartnerState("accepted");
    } catch {
      setPartnerState("failed");
    }
  };
  const circuit = [
    { index: "01", label: "Observe", title: "Canonical evidence", copy: "Decode PONS launches, curve trades, graduations and locks directly from Robinhood Chain.", tone: "var(--signal)", icon: Database },
    { index: "02", label: "Interpret", title: "Attention state", copy: "Turn raw events into momentum, breadth, concentration, lineage and lifecycle signals with visible methodology.", tone: "var(--attention)", icon: ScanLine },
    { index: "03", label: "Distribute", title: "Decision surfaces", copy: "Publish dossiers, shareable research views, alerts, exports and—after validation—machine-readable feeds.", tone: "var(--attention)", icon: Megaphone },
    { index: "04", label: "Context", title: "Research memory", copy: "Carry verified context forward so each new observation can be read against what came before it.", tone: "var(--culture)", icon: Network },
  ];

  return (
    <div className="space-y-3">
      <section className="network-manifesto relative overflow-hidden rounded-[9px] border border-foreground/10 bg-[var(--surface-1)]/90">
        <div className="relative z-10 grid min-h-[340px] gap-8 p-5 sm:p-7 lg:grid-cols-[1.08fr_.92fr] lg:p-9">
          <div className="flex flex-col justify-between">
            <div>
              <div className="flex flex-wrap items-center gap-2 font-mono text-[8px] uppercase tracking-[0.18em]"><span className="text-signal">Network thesis</span><span className="text-foreground/16">/</span><span className="text-foreground/27">PONS intelligence on Robinhood Chain</span></div>
              <h2 className="specimen-serif mt-5 max-w-3xl text-4xl leading-[1.02] tracking-[-0.04em] text-foreground/92 sm:text-5xl xl:text-6xl">Read the market forming <em className="font-normal text-signal">before</em> the chart explains it.</h2>
              <p className="mt-5 max-w-2xl text-sm leading-7 text-foreground/42">Memetic State maps how token launches gather attention around onchain stock terrains. PONS is the first intelligence universe; NVDA is the flagship habitat—not the boundary of the product.</p>
            </div>
            <div className="mt-8 flex flex-wrap items-center gap-3">
              <button type="button" onClick={onOpenSignals} className="inline-flex items-center gap-2 rounded border border-signal/35 bg-signal/10 px-4 py-2.5 font-mono text-[8px] uppercase tracking-[0.14em] text-signal transition hover:bg-signal/15"><Activity className="size-3.5" />Open live signals</button>
              <p className="font-mono text-[7px] uppercase tracking-[0.12em] text-foreground/22">Independent research · no ranking can be bought</p>
            </div>
          </div>
          <div className="state-circuit self-stretch rounded border border-foreground/10 bg-[var(--surface-depth)]/76 p-4 sm:p-5">
            <div className="flex items-center justify-between gap-3"><p className="font-mono text-[8px] uppercase tracking-[0.18em] text-foreground/36">Live proof surface</p><span className="inline-flex items-center gap-1.5 font-mono text-[7px] uppercase tracking-[0.12em]" style={{ color: modeTone(state.mode) }}><i className="size-1.5 rounded-full bg-current" />{state.mode}</span></div>
            <div className="mt-6 grid grid-cols-2 gap-px overflow-hidden rounded border border-foreground/10 bg-foreground/10">
              <div className="bg-[var(--surface-2)] p-4"><p className="network-kicker">launches mapped</p><strong>{integer.format(state.summary.launches)}</strong></div>
              <div className="bg-[var(--surface-2)] p-4"><p className="network-kicker">curve trades</p><strong>{integer.format(state.summary.trades)}</strong></div>
              <div className="bg-[var(--surface-2)] p-4"><p className="network-kicker">creator breadth</p><strong>{integer.format(state.summary.uniqueDeployers)}</strong></div>
              <div className="bg-[var(--surface-2)] p-4"><p className="network-kicker">stock habitats</p><strong>{integer.format(state.summary.stockPairs)}</strong></div>
            </div>
            <div className="mt-5 space-y-3">
              {[{ label: "Canonical event coverage", value: state.index.historicalProgress, tone: "var(--culture)" }, { label: "Resolved token identity", value: state.coverage.metadataPercent, tone: "var(--attention)" }].map((metric) => <div key={metric.label}><div className="mb-1.5 flex items-center justify-between font-mono text-[7px] uppercase tracking-[0.1em] text-foreground/27"><span>{metric.label}</span><span className="text-foreground/55">{metric.value.toFixed(1)}%</span></div><div className="h-1 overflow-hidden rounded bg-foreground/8"><span className="block h-full" style={{ width: `${clampUi(metric.value)}%`, backgroundColor: metric.tone }} /></div></div>)}
            </div>
            <p className="mt-5 border-t border-foreground/8 pt-4 text-[10px] leading-5 text-foreground/27">The commercial moat is accumulated, queryable market memory—not a one-off dashboard or a proprietary mystery score.</p>
          </div>
        </div>
      </section>

      <ResearchPassport passport={passport} localWatchCount={localWatchCount} onRefresh={onRefreshPassport} onSyncWatches={onSyncWatches} />

      <PremiumInterpretationPanel passport={passport} windowBlocks={windowBlocks} />

      <section className="rounded-[9px] border border-foreground/10 bg-[var(--surface-2)]/86 p-5 sm:p-7">
        <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-end"><div><p className="font-mono text-[8px] uppercase tracking-[0.18em] text-signal">State circuit</p><h3 className="specimen-serif mt-2 text-3xl tracking-[-0.03em] text-foreground/88">Evidence becomes a decision product.</h3></div><p className="max-w-md text-xs leading-5 text-foreground/31 sm:text-right">Every commercial layer can be traced back to open, canonical observations.</p></div>
        <div className="mt-6 grid gap-px overflow-hidden rounded border border-foreground/10 bg-foreground/[0.08] md:grid-cols-2 xl:grid-cols-4">
          {circuit.map(({ index, label, title, copy, tone, icon: Icon }) => <article key={label} className="circuit-station bg-[var(--surface-1)] p-5" style={{ "--station-tone": tone } as React.CSSProperties}><div className="flex items-center justify-between"><span className="font-mono text-[7px] tracking-[0.18em] text-foreground/20">{index}</span><Icon className="size-4" style={{ color: tone }} /></div><p className="mt-8 font-mono text-[8px] uppercase tracking-[0.16em]" style={{ color: tone }}>{label}</p><h4 className="mt-2 text-base font-semibold text-foreground/76">{title}</h4><p className="mt-2 text-[11px] leading-5 text-foreground/32">{copy}</p></article>)}
        </div>
      </section>

      <section id="founding-researchers" className="relative overflow-hidden rounded-[9px] border border-signal/16 bg-[var(--surface-1)]/92 p-5 sm:p-7">
        <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-signal/70 to-transparent" />
        <div className="grid gap-8 lg:grid-cols-[.82fr_1.18fr] lg:items-start">
          <div>
            <p className="font-mono text-[8px] uppercase tracking-[0.18em] text-signal">Founding research cohort · 10 seats</p>
            <h3 className="specimen-serif mt-3 text-4xl leading-[1.04] tracking-[-0.035em] text-foreground/90">Help turn PONS monitoring into a workflow you rely on.</h3>
            <p className="mt-4 max-w-xl text-sm leading-7 text-foreground/38">We are recruiting four active researchers, three launch teams, and three ecosystem or data builders. Founding partners get direct input into alerts, history, exports and coverage priorities. Canonical evidence stays public and no ranking can be bought.</p>
            <div className="mt-5 grid gap-2 sm:grid-cols-3 lg:grid-cols-1 xl:grid-cols-3">
              {["Use the observatory twice", "Show us what you still check manually", "Shape one dependable research action"].map((item, index) => <div key={item} className="rounded border border-foreground/8 bg-foreground/[0.018] p-3"><span className="font-mono text-[7px] text-signal/55">0{index + 1}</span><p className="mt-2 text-[10px] leading-4 text-foreground/36">{item}</p></div>)}
            </div>
          </div>
          {partnerState === "accepted" ? (
            <div className="grid min-h-[320px] place-items-center rounded border border-signal/18 bg-signal/[0.035] p-8 text-center">
              <div><CheckCircle2 className="mx-auto size-8 text-signal" /><p className="mt-5 font-mono text-[8px] uppercase tracking-[0.18em] text-signal">Application received</p><h4 className="specimen-serif mt-3 text-3xl text-foreground/86">You’re on the founding research list.</h4><p className="mx-auto mt-3 max-w-md text-xs leading-6 text-foreground/36">We’ll use the contact you provided to arrange a short workflow session. Until then, save a few launches and note what Memetic State should watch while you are away.</p><button type="button" onClick={onOpenWatchlist} className="mt-6 inline-flex items-center gap-2 rounded border border-attention/25 bg-attention/[0.05] px-4 py-2.5 font-mono text-[8px] uppercase tracking-[0.12em] text-attention"><Bookmark className="size-3.5" />Open watchlist</button></div>
            </div>
          ) : (
            <form onSubmit={submitPartner} className="rounded border border-foreground/10 bg-[var(--surface-depth)]/76 p-4 sm:p-5">
              <div className="flex items-center justify-between gap-3"><p className="font-mono text-[8px] uppercase tracking-[0.16em] text-foreground/48">Apply to the cohort</p><span className="font-mono text-[6px] uppercase tracking-[0.1em] text-foreground/20">No wallet required</span></div>
              <label className="mt-5 block"><span className="mb-2 block font-mono text-[7px] uppercase tracking-[0.12em] text-foreground/30">Your role</span><Select value={partnerPersona} onValueChange={setPartnerPersona}><SelectTrigger className="w-full border-foreground/10 bg-foreground/[0.025] text-foreground/60"><SelectValue /></SelectTrigger><SelectContent className="border-foreground/10 bg-[var(--surface-popover)] text-foreground/75"><SelectItem value="researcher">Researcher or trader</SelectItem><SelectItem value="launch-team">PONS launch team</SelectItem><SelectItem value="ecosystem-builder">Ecosystem or data builder</SelectItem></SelectContent></Select></label>
              <label className="mt-4 block"><span className="mb-2 block font-mono text-[7px] uppercase tracking-[0.12em] text-foreground/30">X handle or email</span><Input required minLength={3} maxLength={120} value={partnerContact} onChange={(event) => setPartnerContact(event.target.value)} placeholder="@handle or name@example.com" className="border-foreground/10 bg-foreground/[0.025] text-foreground/70 placeholder:text-foreground/18" /></label>
              <label className="mt-4 block"><span className="mb-2 block font-mono text-[7px] uppercase tracking-[0.12em] text-foreground/30">What do you monitor manually today?</span><textarea required minLength={12} maxLength={800} rows={5} value={partnerWorkflow} onChange={(event) => setPartnerWorkflow(event.target.value)} placeholder="The launch, habitat or activity change you keep checking—and what would make an alert useful." className="w-full resize-y rounded-md border border-foreground/10 bg-foreground/[0.025] px-3 py-2.5 text-xs leading-5 text-foreground/70 outline-none transition placeholder:text-foreground/18 focus:border-signal/30" /></label>
              <input tabIndex={-1} autoComplete="off" aria-hidden="true" name="website" className="hidden" />
              <Button type="submit" disabled={partnerState === "sending"} className="mt-4 w-full border border-signal/30 bg-signal/10 font-mono text-[8px] uppercase tracking-[0.14em] text-signal hover:bg-signal/15"><Users />{partnerState === "sending" ? "Submitting" : partnerState === "failed" ? "Retry application" : "Join founding research cohort"}</Button>
              <p className="mt-3 text-center font-mono text-[6px] uppercase tracking-[0.09em] text-foreground/18">Used only to contact you about Memetic State research access</p>
            </form>
          )}
        </div>
      </section>
    </div>
  );
}

type ObservatoryView = "signals" | "atlas" | "watchlist" | "tape" | "history" | "evidence" | "network";

export function PonsObservatory() {
  const { resolvedTheme, setTheme } = useTheme();
  const [themeReady, setThemeReady] = useState(false);
  const [state, setState] = useState<PonsStateResponse | null>(null);
  const [activePair, setActivePair] = useState("ALL");
  const [selectedAddress, setSelectedAddress] = useState<string | null>(null);
  const [activeView, setActiveView] = useState<ObservatoryView>("signals");
  const [windowBlocks, setWindowBlocks] = useState<number>(DEFAULT_PONS_STATE_WINDOW);
  const [preferencesReady, setPreferencesReady] = useState(false);
  const [watchlist, setWatchlist] = useState<WatchEntry[]>([]);
  const [watchlistReady, setWatchlistReady] = useState(false);
  const [passport, setPassport] = useState<PassportResponse | null>(null);
  const [serverWatchesLoaded, setServerWatchesLoaded] = useState(false);
  const [watchSyncMessage, setWatchSyncMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [copyState, setCopyState] = useState<"idle" | "copied" | "failed">("idle");
  const [wakeState, setWakeState] = useState<"idle" | "sending" | "accepted" | "failed">("idle");

  useEffect(() => {
    const timer = window.setTimeout(() => setThemeReady(true), 0);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const requestedWindow = Number(params.get("window"));
    const requestedView = params.get("view") as ObservatoryView | null;
    const timer = window.setTimeout(() => {
      if (PONS_STATE_WINDOWS.includes(requestedWindow as (typeof PONS_STATE_WINDOWS)[number])) setWindowBlocks(requestedWindow);
      if (requestedView && ["signals", "atlas", "watchlist", "tape", "history", "evidence", "network"].includes(requestedView)) setActiveView(requestedView);
      if (params.get("pair")) setActivePair(params.get("pair")!.toUpperCase());
      if (params.get("token")) setSelectedAddress(params.get("token")!.toLowerCase());
      setPreferencesReady(true);
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setWatchlist(parseWatchlist(window.localStorage.getItem(WATCHLIST_STORAGE_KEY)));
      setWatchlistReady(true);
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (!watchlistReady) return;
    window.localStorage.setItem(WATCHLIST_STORAGE_KEY, JSON.stringify(watchlist));
  }, [watchlist, watchlistReady]);

  const refreshPassport = useCallback(async () => {
    const response = await fetch("/api/entitlements/me", { headers: { accept: "application/json" } });
    const next = await response.json() as PassportResponse;
    setPassport(next);
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => void refreshPassport().catch(() => setPassport(null)), 0);
    return () => window.clearTimeout(timer);
  }, [refreshPassport]);

  useEffect(() => {
    if (!watchlistReady || !passport?.authenticated || serverWatchesLoaded) return;
    let active = true;
    void fetch("/api/watchtower/watches", { headers: { accept: "application/json" } })
      .then(async (response) => {
        if (!response.ok) throw new Error("watch_sync_unavailable");
        return response.json() as Promise<{ watches: WatchEntry[] }>;
      })
      .then(({ watches }) => {
        if (!active) return;
        setWatchlist((current) => {
          const merged = new Map(current.map((entry) => [entry.tokenAddress.toLowerCase(), entry]));
          for (const entry of watches) {
            const previous = merged.get(entry.tokenAddress.toLowerCase());
            if (!previous || new Date(entry.updatedAt).getTime() > new Date(previous.updatedAt).getTime()) {
              merged.set(entry.tokenAddress.toLowerCase(), entry);
            }
          }
          return [...merged.values()].sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
        });
        setServerWatchesLoaded(true);
        if (watches.length) setWatchSyncMessage(`${watches.length} Passport watch${watches.length === 1 ? "" : "es"} restored on this device`);
      })
      .catch(() => {
        if (active) setWatchSyncMessage("Passport sync is temporarily unavailable; device watches remain intact");
      });
    return () => { active = false; };
  }, [passport?.authenticated, serverWatchesLoaded, watchlistReady]);

  const persistWatch = useCallback(async (entry: WatchEntry) => {
    if (!passport?.authenticated) return false;
    const response = await fetch("/api/watchtower/watches", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(entry),
    });
    if (response.status === 409) {
      setWatchSyncMessage("Passport watch capacity reached; this field note remains saved on this device");
      return false;
    }
    if (!response.ok) {
      setWatchSyncMessage("Passport sync failed; this field note remains saved on this device");
      return false;
    }
    setWatchSyncMessage("Field note synced to your Research Passport");
    return true;
  }, [passport?.authenticated]);

  const syncCurrentWatches = useCallback(async () => {
    if (!passport?.authenticated) return { synced: 0, rejected: watchlist.length };
    let synced = 0;
    let rejected = 0;
    for (const entry of watchlist) {
      if (await persistWatch(entry)) synced += 1;
      else rejected += 1;
    }
    await refreshPassport();
    return { synced, rejected };
  }, [passport?.authenticated, persistWatch, refreshPassport, watchlist]);

  const refresh = useCallback(async () => {
    setIsRefreshing(true);
    try {
      const response = await fetch(`/api/pons-state?window=${windowBlocks}`, { headers: { accept: "application/json" } });
      if (!response.ok) throw new Error("The PONS evidence endpoint has not become available yet.");
      const next = await response.json() as PonsStateResponse;
      setState(next);
      void fetch("/api/collector/heartbeat", {
        method: "POST",
        headers: { accept: "application/json" },
        keepalive: true,
      }).catch(() => undefined);
      if (watchlistReady) {
        setWatchlist((current) => reconcileWatchlist(current, next.launches, next.generatedAt).entries);
      }
      setError(null);
      setActivePair((current) => current === "ALL" || next.cohorts.some((cohort) => cohort.symbol === current) ? current : "ALL");
      if (next.launches.length) {
        setSelectedAddress((current) => current && next.launches.some((launch) => launch.tokenAddress === current)
          ? current
          : next.launches.find((launch) => launch.pairSymbol === "NVDA")?.tokenAddress
          ?? next.launches[0].tokenAddress);
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "PONS state unavailable");
    } finally {
      setIsRefreshing(false);
    }
  }, [watchlistReady, windowBlocks]);

  useEffect(() => {
    if (!preferencesReady) return;
    const initial = window.setTimeout(() => void refresh(), 0);
    const timer = window.setInterval(refresh, 30_000);
    return () => {
      window.clearTimeout(initial);
      window.clearInterval(timer);
    };
  }, [preferencesReady, refresh]);

  useEffect(() => {
    if (!preferencesReady) return;
    const url = new URL(window.location.href);
    url.searchParams.set("view", activeView);
    url.searchParams.set("pair", activePair);
    url.searchParams.set("window", String(windowBlocks));
    if (selectedAddress) url.searchParams.set("token", selectedAddress);
    else url.searchParams.delete("token");
    window.history.replaceState(null, "", `${url.pathname}?${url.searchParams.toString()}`);
  }, [activePair, activeView, preferencesReady, selectedAddress, windowBlocks]);

  const wake = async () => {
    setWakeState("sending");
    try {
      const response = await fetch("/api/collector/wake", { method: "POST", headers: { accept: "application/json" } });
      if (!response.ok) throw new Error("wake rejected");
      setWakeState("accepted");
      window.setTimeout(() => void refresh(), 3_500);
    } catch {
      setWakeState("failed");
    }
  };

  const copyView = async () => {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setCopyState("copied");
      window.setTimeout(() => setCopyState("idle"), 1_800);
    } catch {
      setCopyState("failed");
      window.setTimeout(() => setCopyState("idle"), 1_800);
    }
  };

  const cohort = state?.cohorts.find((item) => item.symbol === activePair) ?? null;
  const filteredLaunches = useMemo(() => state?.launches.filter((launch) => activePair === "ALL" || launch.pairSymbol === activePair) ?? [], [state, activePair]);
  const selected = useMemo(() => {
    const exact = filteredLaunches.find((launch) => launch.tokenAddress === selectedAddress);
    return exact ?? filteredLaunches[0] ?? null;
  }, [filteredLaunches, selectedAddress]);

  const choosePair = (pair: string) => {
    setActivePair(pair);
    const candidate = state?.launches.find((launch) => pair === "ALL" || launch.pairSymbol === pair);
    setSelectedAddress(candidate?.tokenAddress ?? null);
  };

  const inspectLaunch = (launch: PonsLaunchView) => setSelectedAddress(launch.tokenAddress);
  const inspectLeader = (address: string) => {
    const launch = state?.launches.find((item) => item.tokenAddress === address);
    if (!launch) return;
    setActivePair(launch.pairSymbol);
    setSelectedAddress(launch.tokenAddress);
    setActiveView("signals");
  };

  const isSaved = (tokenAddress: string) => watchlist.some((entry) => entry.tokenAddress === tokenAddress.toLowerCase());
  const toggleWatch = (launch: PonsLaunchView) => {
    const tokenAddress = launch.tokenAddress.toLowerCase();
    const existing = watchlist.find((entry) => entry.tokenAddress === tokenAddress);
    if (existing) {
      setWatchlist((current) => current.filter((entry) => entry.tokenAddress !== tokenAddress));
      if (passport?.authenticated) void fetch("/api/watchtower/watches", { method: "DELETE", headers: { "content-type": "application/json" }, body: JSON.stringify({ tokenAddress }) }).then(() => refreshPassport()).catch(() => undefined);
      return;
    }
    const entry = createWatchEntry(launch);
    setWatchlist((current) => [entry, ...current]);
    void persistWatch(entry).then(() => refreshPassport()).catch(() => undefined);
  };
  const updateWatchRules = (tokenAddress: string, rules: WatchRules) => {
    const current = watchlist.find((entry) => entry.tokenAddress === tokenAddress.toLowerCase());
    if (!current) return;
    const updated = { ...current, rules, updatedAt: new Date().toISOString() };
    setWatchlist((entries) => entries.map((entry) => entry.tokenAddress === tokenAddress.toLowerCase() ? updated : entry));
    void persistWatch(updated).catch(() => undefined);
  };
  const removeWatch = (tokenAddress: string) => {
    setWatchlist((current) => current.filter((entry) => entry.tokenAddress !== tokenAddress.toLowerCase()));
    if (passport?.authenticated) void fetch("/api/watchtower/watches", { method: "DELETE", headers: { "content-type": "application/json" }, body: JSON.stringify({ tokenAddress }) }).then(() => refreshPassport()).catch(() => undefined);
  };
  const markWatchAlertsRead = () => {
    const updated = watchlist.map((entry) => ({ ...entry, updatedAt: new Date().toISOString(), alerts: entry.alerts.map((item) => ({ ...item, read: true })) }));
    setWatchlist(updated);
    if (passport?.authenticated) void Promise.all(updated.map((entry) => persistWatch(entry))).catch(() => undefined);
  };
  const inspectWatched = (launch: PonsLaunchView) => {
    setActivePair(launch.pairSymbol);
    setSelectedAddress(launch.tokenAddress);
    setActiveView("atlas");
  };
  const unreadWatchAlerts = watchlist.reduce((total, entry) => total + entry.alerts.filter((item) => !item.read).length, 0);

  return (
    <main className="min-h-screen px-3 pb-4 sm:px-5 lg:px-7">
      <div className="mx-auto max-w-[1720px]">
        <header className="observatory-header sticky top-0 z-40 -mx-3 mb-3 flex flex-wrap items-center justify-between gap-3 border-b border-foreground/10 px-3 py-3 backdrop-blur-xl sm:-mx-5 sm:px-5 lg:-mx-7 lg:px-7">
          <div className="flex items-center gap-3">
            <div className="state-glyph-shell grid size-11 place-items-center text-signal"><StateGlyph className="size-10" /></div>
            <div><div className="flex items-baseline gap-2"><h1 className="text-sm font-semibold uppercase tracking-[0.18em] text-foreground">Memetic <span className="specimen-serif text-base font-normal italic normal-case tracking-normal text-culture">State</span></h1><span className="hidden font-mono text-[7px] uppercase tracking-[0.14em] text-foreground/20 sm:inline">/ PONS intelligence</span></div><p className="mt-0.5 font-mono text-[8px] uppercase tracking-[0.15em] text-foreground/28">Independent attention intelligence for Robinhood Chain</p></div>
          </div>
          <div className="flex items-center gap-2">
            <div className="hidden text-right lg:block"><p className="font-mono text-[7px] uppercase tracking-[0.13em] text-foreground/20">Last verified collection</p><p className="mt-1 flex items-center justify-end gap-1.5 font-mono text-[8px] uppercase tracking-[0.1em] text-foreground/42"><Clock3 className="size-3" />{state?.index.lastSuccessAt ? relativeTime(state.index.lastSuccessAt) : "connecting"}</p></div>
            <Button type="button" variant="outline" size="icon-sm" onClick={() => void copyView()} aria-label="Copy current observatory view" title="Copy current view"
              className="border-foreground/10 bg-foreground/[0.025] text-foreground/38 hover:bg-foreground/[0.06] hover:text-foreground/75"><Copy className="size-3.5" /></Button>
            <Button type="button" variant="outline" size="icon-sm" onClick={() => void refresh()} aria-label="Refresh PONS state" title="Refresh state"
              className="border-foreground/10 bg-foreground/[0.025] text-foreground/38 hover:bg-foreground/[0.06] hover:text-signal"><RefreshCw className={`size-3.5 ${isRefreshing ? "animate-spin" : ""}`} /></Button>
            <Button type="button" variant="outline" size="icon-sm" onClick={() => setTheme(resolvedTheme === "light" ? "dark" : "light")} aria-label={`Use ${resolvedTheme === "light" ? "dark" : "light"} atlas`} title={`Use ${resolvedTheme === "light" ? "dark" : "light"} atlas`}
              className="border-foreground/10 bg-foreground/[0.025] text-foreground/38 hover:bg-foreground/[0.06] hover:text-culture">
              {themeReady && resolvedTheme === "light" ? <Moon className="size-3.5" /> : <Sun className="size-3.5" />}
            </Button>
            <div className="flex items-center gap-2 rounded border border-foreground/10 bg-foreground/[0.035] px-3 py-2 font-mono text-[8px] uppercase tracking-[0.12em]" style={{ color: modeTone(state?.mode) }}><span className="relative flex size-1.5"><span className="absolute inline-flex size-full animate-ping rounded-full bg-current opacity-35" /><span className="relative size-1.5 rounded-full bg-current" /></span>{state?.mode ?? "connecting"}<span className="hidden sm:inline">{state?.index.latestIndexedBlock ? ` · #${integer.format(state.index.latestIndexedBlock)}` : ""}</span></div>
          </div>
        </header>

        {copyState !== "idle" ? <div role="status" className="fixed right-4 top-20 z-50 rounded border border-foreground/10 bg-[var(--surface-popover)]/95 px-3 py-2 font-mono text-[8px] uppercase tracking-[0.1em] text-signal shadow-xl">{copyState === "copied" ? "View link copied" : "Copy unavailable"}</div> : null}
        {state ? <IntegrityRail state={state} /> : null}
        {error && state ? <div role="status" className="mb-3 flex items-center justify-between gap-3 rounded border border-danger/20 bg-danger/[0.045] px-3 py-2 font-mono text-[8px] text-danger/75"><span>{error} · showing the last verified state</span><button type="button" onClick={() => void refresh()} className="uppercase tracking-[0.1em]">Retry</button></div> : null}
        {!state || state.mode === "empty" ? <EmptyEngine error={error} onWake={() => void wake()} wakeState={wakeState} /> : (
          <Tabs value={activeView} onValueChange={(value) => setActiveView(value as ObservatoryView)} className="gap-3">
            <div className="observatory-toolbar flex flex-wrap items-center justify-between gap-3 rounded-[7px] border border-foreground/10 bg-[var(--surface-1)]/78 px-3">
              <TabsList variant="line" className="h-11 max-w-full gap-4 overflow-x-auto p-0 [scrollbar-width:none] sm:gap-5">
                <TabsTrigger value="signals" className="px-0 font-mono text-[8px] uppercase tracking-[0.13em] sm:text-[9px]"><BarChart3 />Signals</TabsTrigger>
                <TabsTrigger value="atlas" className="px-0 font-mono text-[8px] uppercase tracking-[0.13em] sm:text-[9px]"><Orbit />Atlas</TabsTrigger>
                <TabsTrigger value="watchlist" className="px-0 font-mono text-[8px] uppercase tracking-[0.13em] sm:text-[9px]"><BellRing />Watchlist{watchlist.length ? <span className={`ml-0.5 rounded px-1.5 py-0.5 text-[6px] ${unreadWatchAlerts ? "bg-signal/10 text-signal" : "bg-foreground/[0.055] text-foreground/30"}`}>{unreadWatchAlerts || watchlist.length}</span> : null}</TabsTrigger>
                <TabsTrigger value="tape" className="px-0 font-mono text-[8px] uppercase tracking-[0.13em] sm:text-[9px]"><Activity />Lifecycle</TabsTrigger>
                <TabsTrigger value="history" className="px-0 font-mono text-[8px] uppercase tracking-[0.13em] sm:text-[9px]"><History />History</TabsTrigger>
                <TabsTrigger value="evidence" className="px-0 font-mono text-[8px] uppercase tracking-[0.13em] sm:text-[9px]"><Database />Evidence</TabsTrigger>
                <TabsTrigger value="network" className="px-0 font-mono text-[8px] uppercase tracking-[0.13em] sm:text-[9px]"><Network />Network</TabsTrigger>
              </TabsList>
              <div className="flex items-center gap-2 pb-2 sm:pb-0">
                <span className="hidden font-mono text-[7px] uppercase tracking-[0.1em] text-foreground/20 sm:inline">Research window</span>
                <Select value={String(windowBlocks)} onValueChange={(value) => setWindowBlocks(Number(value))}>
                  <SelectTrigger aria-label="Select research window" size="sm" className="w-[142px] border-foreground/10 bg-foreground/[0.025] font-mono text-[7px] uppercase tracking-[0.08em] text-foreground/55"><SelectValue /></SelectTrigger>
                  <SelectContent className="border-foreground/10 bg-[var(--surface-popover)] text-foreground/70">{PONS_STATE_WINDOWS.map((blocks) => <SelectItem key={blocks} value={String(blocks)}>{integer.format(blocks)} blocks · {windowLabel(blocks)}</SelectItem>)}</SelectContent>
                </Select>
              </div>
            </div>
            <TabsContent value="signals">
              <ProtocolPulse state={state} onLeader={inspectLeader} />
              <ProtocolCoveragePanel state={state} />
              <StateMemoryPanel state={state} />
              <div className="mt-3"><CohortStrip cohorts={state.cohorts} activePair={activePair} onPair={choosePair} /></div>
              <SignalDesk launches={filteredLaunches} selected={selected} onSelect={inspectLaunch} state={state} isSaved={isSaved} onToggleSave={toggleWatch} />
              <CohortMatrix cohorts={state.cohorts} onPair={choosePair} />
            </TabsContent>
            <TabsContent value="atlas">
              <CohortStrip cohorts={state.cohorts} activePair={activePair} onPair={choosePair} />
              <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_410px] xl:grid-cols-[minmax(0,1fr)_450px]">
                <PonsGravityField pair={activePair} cohort={cohort} launches={filteredLaunches} selected={selected} onSelect={inspectLaunch} />
                <LaunchDossier launch={selected} saved={selected ? isSaved(selected.tokenAddress) : false} onToggleSave={toggleWatch} />
              </div>
              <CohortMatrix cohorts={state.cohorts} onPair={choosePair} />
            </TabsContent>
            <TabsContent value="watchlist"><WatchlistPanel entries={watchlist} launches={state.launches} onInspect={inspectWatched} onRulesChange={updateWatchRules} onRemove={removeWatch} onReadAll={markWatchAlertsRead} storageMode={passport?.authenticated ? "passport" : "device"} syncMessage={watchSyncMessage} /></TabsContent>
            <TabsContent value="tape"><PonsTape events={state.tape} /></TabsContent>
            <TabsContent value="history"><ProtocolHistoryPanel state={state} /></TabsContent>
            <TabsContent value="evidence"><ProtocolCoveragePanel state={state} /><StateMemoryPanel state={state} /><div className="mt-3"><EvidencePanel state={state} onWake={() => void wake()} wakeState={wakeState} /></div></TabsContent>
            <TabsContent value="network"><NetworkPanel state={state} passport={passport} localWatchCount={watchlist.length} windowBlocks={windowBlocks} onOpenSignals={() => setActiveView("signals")} onOpenWatchlist={() => setActiveView("watchlist")} onRefreshPassport={refreshPassport} onSyncWatches={syncCurrentWatches} /></TabsContent>
          </Tabs>
        )}

        <footer className="mt-4 flex flex-col justify-between gap-2 border-t border-foreground/10 px-1 pt-4 font-mono text-[7px] uppercase tracking-[0.12em] text-foreground/20 sm:flex-row">
          <span>{state?.index.source ?? "PONS V2 canonical factory"}{state?.index.lastSuccessAt ? ` · collected ${relativeTime(state.index.lastSuccessAt)}` : ""}</span>
          <span>Attention describes observed activity—not asset quality, backing, or financial merit</span>
        </footer>
      </div>
    </main>
  );
}
