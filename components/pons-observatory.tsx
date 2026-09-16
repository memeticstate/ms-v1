"use client";

import { robinhoodExplorer } from "@/lib/robinhood-explorer";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Activity,
  ArrowDown,
  ArrowDownRight,
  ArrowUp,
  ArrowUpDown,
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
  ShieldCheck,
  Sparkles,
  TimerReset,
  Users,
} from "lucide-react";

import { AppHeader } from "@/components/app-header";
import { FieldGuide, GuidedReading } from "@/components/field-guide";
import { useMemeticAuth } from "@/components/memetic-auth-provider";
import { ResearchPassport } from "@/components/research-passport";
import { TokenSearch } from "@/components/token-search";
import { TokenAvatar } from "@/components/token-avatar";
import { TokenOverview } from "@/components/token-overview";
import { tokenText, tokenTitle, type TokenSearchResult } from "@/lib/tokens/model";
import { ProtocolCoveragePanel } from "@/components/protocol-coverage";
import { PulseEvidence } from "@/components/pulse-evidence";
import { FactoryActivity } from "@/components/factory-activity";
import { useFactoryStream } from "@/components/use-factory-stream";
import type { PulseMetricKey, PulseSelection } from "@/lib/pons/pulse-evidence";
import { PremiumInterpretationPanel } from "@/components/premium-interpretation";
import { PremiumResearchWorkspace } from "@/components/premium-research";
import { WatchlistPanel } from "@/components/watchlist-panel";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { launchesForPair, pairSelection, selectedLaunch } from "@/lib/pons/navigation";
import { appTokenHref, parseObservatoryLocation, type ObservatoryExperience, type ObservatoryView } from "@/lib/app-navigation";
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
  PonsTokenStateTransition,
} from "@/lib/pons/model";
import type { PassportResponse } from "@/lib/entitlements/client";
import { downloadPulseCard } from "@/lib/pons/pulse-card";
import { DEFAULT_PONS_STATE_WINDOW, PONS_STATE_WINDOWS } from "@/lib/pons/signals";
import { quoteAssetLabel } from "@/lib/pons/quote-label";
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
  historical: { label: "Historical", color: "var(--slate)", description: "Indexed history, not a current signal." },
  unverified: { label: "Unverified", color: "var(--attention)", description: "Current participation has not passed the evidence requirements." },
  inactive: { label: "Inactive", color: "var(--slate)", description: "No verified current activity or depleted participation." },
  stressed: { label: "Stressed", color: "var(--danger)", description: "Measured participation decline or dominant outflows." },
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
    <span className="inline-flex items-center gap-1.5 rounded border px-2 py-1 font-medium text-xs tracking-normal"
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
    <span className="inline-flex items-center gap-1 font-mono text-xs"
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
      <p className="mt-6 font-medium text-caption tracking-normal text-signal">Canonical index warming</p>
      <h2 className="specimen-serif mx-auto mt-3 max-w-2xl text-4xl tracking-[-0.035em] text-foreground/90 sm:text-5xl">
        The factory is connected. The first verified activity window is being reconstructed.
      </h2>
      <p className="mx-auto mt-4 max-w-xl text-sm leading-7 text-muted-foreground">
        No synthetic launches are shown. Recent PONS V2 events will appear after they have been decoded, linked to their curves, and committed to the evidence archive.
      </p>
      {error ? <p className="mx-auto mt-4 max-w-lg font-mono text-caption text-danger/75">{error}</p> : null}
      <button type="button" onClick={onWake} disabled={wakeState === "sending"}
        className="mt-7 inline-flex items-center gap-2 rounded border border-signal/30 bg-signal/8 px-4 py-2.5 font-medium text-caption tracking-normal text-signal transition hover:bg-signal/12 disabled:opacity-50">
        <RefreshCw className={`size-3.5 ${wakeState === "sending" ? "animate-spin" : ""}`} />
        {wakeState === "accepted" ? "Indexer dispatched" : wakeState === "failed" ? "Retry indexer" : "Run indexer now"}
      </button>
    </section>
  );
}

function IntegrityRail({ state, onMetric }: { state: PonsStateResponse; onMetric: (label: string) => void }) {
  const cells = [
    { icon: Sparkles, label: "Launches", value: compact.format(state.summary.launches), tone: "var(--attention)" },
    { icon: Fingerprint, label: "Creator breadth", value: compact.format(state.summary.uniqueDeployers), tone: "var(--signal)" },
    { icon: Activity, label: "Curve trades", value: compact.format(state.summary.trades), tone: "var(--attention)" },
    { icon: Orbit, label: "Graduations", value: compact.format(state.summary.graduations), tone: "var(--culture)" },
    { icon: Blocks, label: "Stock terrains", value: integer.format(state.summary.stockPairs), tone: "var(--signal)" },
    { icon: RadioTower, label: "Index lag", value: `${integer.format(state.index.liveLagBlocks)} blocks`, tone: modeTone(state.mode) },
  ];
  return (
    <section aria-label="PONS observation integrity" className="observation-rail mb-3 grid grid-cols-2 overflow-hidden rounded-2xl border border-foreground/10 bg-[var(--surface-1)]/82 md:grid-cols-3 xl:grid-cols-6">
      {cells.map(({ icon: Icon, label, value, tone }) => (
        <button type="button" key={label} onClick={() => onMetric(label)} aria-label={`Explore ${label.toLowerCase()}`} className="observation-cell text-left transition hover:bg-foreground/5 focus-visible:outline-2 focus-visible:outline-inset focus-visible:outline-signal">
          <Icon aria-hidden="true" className="size-3.5 shrink-0" style={{ color: tone }} />
          <div className="min-w-0"><p className="observation-label">{label}</p><p className="observation-value">{value}</p></div>
        </button>
      ))}
    </section>
  );
}

function PulseCell({ icon: Icon, label, metric, tone, onClick }: {
  icon: typeof Activity;
  label: string;
  metric: PonsPulseMetric;
  tone: string;
  onClick: () => void;
}) {
  const maximum = Math.max(1, metric.current, metric.previous);
  return (
    <button type="button" className="pulse-cell group" onClick={onClick} aria-label={`Explore ${label.toLowerCase()} in this pulse interval`}>
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2">
          <Icon className="size-3.5" style={{ color: tone }} />
          <span className="font-medium text-xs tracking-normal text-muted-foreground">{label}</span>
        </div>
        <Momentum value={metric.changePercent} current={metric.current} previous={metric.previous} />
      </div>
      <div className="mt-3 flex items-baseline gap-2">
        <strong className="font-mono text-3xl font-medium tracking-[-0.04em] text-foreground/90">{integer.format(metric.current)}</strong>
        <span className="font-medium text-xs tracking-normal text-muted-foreground">vs {integer.format(metric.previous)}</span>
      </div>
      <div className="mt-3 space-y-1">
        <div className="h-1 overflow-hidden rounded-full bg-foreground/[0.055]"><div className="h-full rounded-full" style={{ width: `${metric.current / maximum * 100}%`, backgroundColor: tone }} /></div>
        <div className="h-px overflow-hidden bg-foreground/[0.035]"><div className="h-full bg-foreground/25" style={{ width: `${metric.previous / maximum * 100}%` }} /></div>
      </div>
      <span className="mt-3 flex items-center justify-between font-mono text-[9px] uppercase tracking-[0.13em] text-muted-foreground transition group-hover:text-foreground"><span>Explore {label.toLowerCase()}</span><ArrowUpRight className="size-3.5" style={{ color: tone }} /></span>
    </button>
  );
}

function ProtocolPulse({ state, onLeader, onMetric }: { state: PonsStateResponse; onLeader: (address: string) => void; onMetric: (metric: PulseMetricKey) => void }) {
  const pulse = state.pulse;
  const pulseTone = pulse.status === "verified" ? "var(--signal)" : pulse.status === "delayed" ? "var(--culture)" : "var(--slate)";
  const [briefState, setBriefState] = useState<"idle" | "copied" | "failed">("idle");
  const [cardState, setCardState] = useState<"idle" | "exporting" | "exported" | "failed">("idle");
  const copyPulse = async () => {
    const change = (metric: PonsPulseMetric) => momentumLabel(metric.changePercent, metric.current, metric.previous);
    const leader = pulse.leader ? ` Leader: ${pulse.leader.tokenSymbol}/${quoteAssetLabel(pulse.leader.pairSymbol)} · ${pulse.leader.recentTrades} trades.` : "";
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
    <section className="signal-briefing overflow-hidden rounded-2xl border border-foreground/10 bg-[var(--surface-1)]/86">
      <div className="grid gap-4 border-b border-foreground/10 px-4 py-4 lg:grid-cols-[1fr_auto] lg:items-end">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-medium text-caption tracking-normal" style={{ color: pulseTone }}>{pulse.status} protocol pulse</span>
            <span className="rounded border border-foreground/10 px-2 py-1 font-medium text-xs tracking-normal text-muted-foreground">two adjacent {integer.format(pulse.windowBlocks)}-block intervals</span>
            <span className="rounded border px-2 py-1 font-medium text-xs tracking-normal" style={{
              color: state.integrity.pulseReconciled ? "var(--signal)" : "var(--danger)",
              borderColor: state.integrity.pulseReconciled ? "color-mix(in srgb, var(--signal) 28%, transparent)" : "color-mix(in srgb, var(--danger) 28%, transparent)",
              backgroundColor: state.integrity.pulseReconciled ? "color-mix(in srgb, var(--signal) 6%, transparent)" : "color-mix(in srgb, var(--danger) 6%, transparent)",
            }}>{state.integrity.pulseReconciled ? "cohort totals reconciled" : "cohort mismatch"}</span>
            {pulse.status === "delayed" ? <span className="rounded border border-culture/20 bg-culture/[0.045] px-2 py-1 font-medium text-xs tracking-normal text-culture">indexed edge · {integer.format(state.index.liveLagBlocks)} blocks behind</span> : null}
          </div>
          <h2 className="specimen-serif mt-2 text-3xl tracking-[-0.035em] text-foreground/90 sm:text-4xl">How did verified PONS activity change at the indexed edge?</h2>
          <p className="mt-2 text-xs text-muted-foreground">Current versus prior ~{pulse.approximateMinutes}-minute interval, ending at block #{integer.format(state.index.latestIndexedBlock)}.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2 lg:justify-end">
          <Button type="button" variant="outline" size="sm" onClick={() => void exportCard()} disabled={cardState === "exporting"}
            className="border-attention/20 bg-attention/[0.035] font-medium text-xs tracking-normal text-attention hover:bg-attention/[0.08] hover:text-attention">
            <ImageDown />{cardState === "exporting" ? "Rendering PNG" : cardState === "exported" ? "PNG exported" : cardState === "failed" ? "Export failed" : "Export X card"}
          </Button>
          <Button type="button" variant="outline" size="sm" onClick={() => void copyPulse()}
            className="border-foreground/10 bg-foreground/[0.025] font-medium text-xs tracking-normal text-muted-foreground hover:bg-foreground/[0.06] hover:text-signal">
            <Copy />{briefState === "copied" ? "Pulse copied" : briefState === "failed" ? "Copy failed" : "Copy pulse"}
          </Button>
          {pulse.leader ? (
            <button type="button" onClick={() => onLeader(pulse.leader!.tokenAddress)}
              className="group rounded border border-attention/20 bg-attention/[0.045] px-3 py-2.5 text-left transition hover:border-attention/35">
              <span className="block font-medium text-xs tracking-normal text-muted-foreground">Most active launch</span>
              <span className="mt-1 flex items-center gap-2 font-mono text-caption text-attention">{pulse.leader.tokenSymbol} <i className="text-muted-foreground not-italic">{quoteAssetLabel(pulse.leader.pairSymbol)} · {pulse.leader.recentTrades} trades</i><ArrowUpRight className="size-3 transition group-hover:translate-x-0.5 group-hover:-translate-y-0.5" /></span>
            </button>
          ) : <span className="font-medium text-xs tracking-normal text-muted-foreground">Pulse warming</span>}
        </div>
      </div>
      <div className="grid md:grid-cols-2 xl:grid-cols-4">
        <PulseCell icon={Activity} label="Curve trades" metric={pulse.trades} tone="var(--attention)" onClick={() => onMetric("trades")} />
        <PulseCell icon={Users} label="Distinct actors" metric={pulse.uniqueTraders} tone="var(--signal)" onClick={() => onMetric("actors")} />
        <PulseCell icon={Sparkles} label="New launches" metric={pulse.launches} tone="var(--attention)" onClick={() => onMetric("launches")} />
        <PulseCell icon={Orbit} label="Graduations" metric={pulse.graduations} tone="var(--culture)" onClick={() => onMetric("graduations")} />
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
  if (state.pulse.status !== "verified") return <section className="mt-3 rounded-lg border border-foreground/15 bg-[var(--surface-2)] p-5"><h3 className="text-lg">State Memory · comparison withheld</h3><p className="mt-2 text-sm leading-6 text-foreground/65">The index is delayed. Catch-up observations are not evidence of a change happening now. Historical counts remain available in the archive; current cultural and momentum interpretations resume only with fresh evidence.</p></section>;
  const ready = state.memory.horizons.filter((horizon) => horizon.status === "ready").length;
  return (
    <section className="state-memory mt-3 overflow-hidden rounded-2xl border border-foreground/10 bg-[var(--surface-depth)]/88">
      <div className="flex flex-wrap items-start justify-between gap-4 border-b border-foreground/10 px-4 py-4 sm:px-5">
        <div className="flex gap-3">
          <span className="mt-0.5 grid size-8 place-items-center rounded border border-culture/20 bg-culture/[0.045] text-culture"><History className="size-4" /></span>
          <div>
            <p className="font-medium text-caption tracking-normal text-culture">State Memory</p>
            <h3 className="specimen-serif mt-1 text-2xl tracking-[-0.025em] text-foreground/86">Is the market merely loud—or outside its own recent character?</h3>
            <p className="mt-1 max-w-3xl text-xs leading-5 text-muted-foreground">Each stratum compares the same {integer.format(state.memory.observationWindowBlocks)}-block observation window now with its durable state at that horizon.</p>
          </div>
        </div>
        <span className="rounded border border-foreground/10 bg-foreground/[0.025] px-2.5 py-1.5 font-medium text-xs tracking-normal text-muted-foreground">{ready}/5 horizons resolved · through #{integer.format(state.memory.currentThroughBlock)}</span>
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
                <div><span className="font-medium text-xs tracking-normal text-muted-foreground">Stratum {String(index + 1).padStart(2, "0")}</span><h4 className="mt-1 font-mono text-sm text-foreground/78">{horizon.id}</h4></div>
                <span className="font-mono text-xs" style={{ color: tone }}>{memoryDelta(horizon.trades.changePercent)}</span>
              </div>
              {horizon.status === "ready" ? (
                <>
                  <div className="mt-4 flex items-end justify-between gap-3"><div><p className="font-medium text-xs tracking-normal text-muted-foreground">Curve trades</p><p className="mt-1 font-mono text-xl text-foreground/84">{integer.format(horizon.trades.current)}</p></div><p className="text-right font-mono text-xs uppercase leading-4 tracking-[0.08em] text-muted-foreground">then<br /><strong className="text-caption text-muted-foreground">{integer.format(horizon.trades.baseline ?? 0)}</strong></p></div>
                  <div className="mt-3 space-y-1"><div className="h-1 overflow-hidden rounded bg-foreground/[0.055]"><span className="block h-full rounded" style={{ width: `${horizon.trades.current / maximum * 100}%`, backgroundColor: tone }} /></div><div className="h-px overflow-hidden bg-foreground/[0.035]"><span className="block h-full bg-foreground/28" style={{ width: `${(horizon.trades.baseline ?? 0) / maximum * 100}%` }} /></div></div>
                  <dl className="mt-4 grid grid-cols-2 gap-2 border-t border-foreground/[0.07] pt-3 font-mono"><div><dt className="text-xs uppercase tracking-[0.1em] text-muted-foreground">Actors</dt><dd className="mt-1 text-caption text-foreground/60">{integer.format(horizon.activeTraders.current)} <span className="text-muted-foreground">/ {integer.format(horizon.activeTraders.baseline ?? 0)}</span></dd></div><div><dt className="text-xs uppercase tracking-[0.1em] text-muted-foreground">Launches</dt><dd className="mt-1 text-caption text-foreground/60">{integer.format(horizon.launches.current)} <span className="text-muted-foreground">/ {integer.format(horizon.launches.baseline ?? 0)}</span></dd></div></dl>
                  <p className="mt-3 min-h-8 border-t border-foreground/[0.07] pt-3 font-mono text-xs uppercase leading-4 tracking-[0.08em] text-muted-foreground">Leader {horizon.leader.changed ? <span className="text-culture">migrated {horizon.leader.baseline} → {horizon.leader.current}</span> : <span className="text-attention">held at {horizon.leader.current ?? "—"}</span>}</p>
                </>
              ) : (
                <div className="mt-4 grid min-h-[145px] place-items-center rounded border border-dashed border-foreground/10 bg-foreground/[0.018] px-3 text-center"><p className="font-mono text-xs uppercase leading-4 tracking-[0.1em] text-muted-foreground">Accumulating a trustworthy<br />{horizon.label} baseline</p></div>
              )}
            </article>
          );
        })}
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-foreground/10 px-4 py-3 font-medium text-xs tracking-normal text-muted-foreground sm:px-5"><span>Current / historical snapshot · activity state, not price forecast</span><span>Missing horizons stay visibly warming</span></div>
    </section>
  );
}

function ProtocolHistoryPanel({ state }: { state: PonsStateResponse }) {
  const [ascending, setAscending] = useState(false);
  const history = state.history;
  if (!history) {
    return (
      <section className="rounded-2xl border border-foreground/10 bg-[var(--surface-1)]/84 p-8 text-center">
        <History className="mx-auto size-6 text-culture" />
        <p className="mt-4 font-medium text-xs tracking-normal text-culture">Historical ledger warming</p>
        <p className="mx-auto mt-2 max-w-xl text-xs leading-5 text-muted-foreground">The current and legacy PONS factories are being registered. No historical launch or swap is displayed until its canonical log has been committed.</p>
      </section>
    );
  }
  return (
    <div className="space-y-3">
      <section className="overflow-hidden rounded-2xl border border-foreground/10 bg-[var(--surface-1)]/86">
        <div className="flex flex-wrap items-start justify-between gap-4 border-b border-foreground/10 p-5 sm:p-6">
          <div><p className="font-medium text-xs tracking-normal text-culture">Indexed PONS history</p><h2 className="specimen-serif mt-2 text-3xl tracking-[-0.03em] text-foreground/88">One archive, without flattening protocol generations.</h2><p className="mt-2 max-w-3xl text-xs leading-5 text-muted-foreground">V2 curve activity and V1 Uniswap V3 activity remain mechanically distinct. Launch discovery commits first; swap history follows behind it, so coverage is measurable instead of implied.</p></div>
          <div className="grid grid-cols-2 gap-px overflow-hidden rounded border border-foreground/10 bg-foreground/10 font-mono"><div className="bg-[var(--surface-2)] px-4 py-3"><p className="text-xs uppercase tracking-[0.11em] text-muted-foreground">V1 launches</p><p className="mt-1 text-lg text-foreground/76">{integer.format(history.launchCount)}</p></div><div className="bg-[var(--surface-2)] px-4 py-3"><p className="text-xs uppercase tracking-[0.11em] text-muted-foreground">V1 swaps</p><p className="mt-1 text-lg text-foreground/76">{integer.format(history.swapCount)}</p></div></div>
        </div>
        <div className="grid gap-px bg-foreground/10 lg:grid-cols-2">
          {history.generations.map((generation) => {
            const healthy = generation.consecutiveFailures === 0;
            return <article key={generation.id} data-generation={generation.id} className="bg-[var(--surface-2)] p-5"><div className="flex items-start justify-between gap-3"><div><p className="font-medium text-xs tracking-normal text-attention">{generation.id === "v1-current" ? "Current V1" : "Legacy V1"}</p><p className="mt-1 text-xs text-muted-foreground">Uniswap V3 launch + pool activity</p></div><span className="rounded border px-2 py-1 font-medium text-xs tracking-normal" style={{ color: healthy ? "var(--signal)" : "var(--danger)", borderColor: healthy ? "color-mix(in srgb, var(--signal) 25%, transparent)" : "color-mix(in srgb, var(--danger) 25%, transparent)" }}>{healthy ? "reconciled" : `${generation.consecutiveFailures} failures`}</span></div><div className="mt-5 grid grid-cols-2 gap-4"><div><div className="flex justify-between font-medium text-xs tracking-normal text-muted-foreground"><span>Launch discovery</span><span>{generation.launchProgress.toFixed(1)}%</span></div><Progress value={generation.launchProgress} className="mt-2 h-1 bg-foreground/8 [&>div]:bg-attention" /></div><div><div className="flex justify-between font-medium text-xs tracking-normal text-muted-foreground"><span>Swap history</span><span>{generation.swapProgress.toFixed(1)}%</span></div><Progress value={generation.swapProgress} className="mt-2 h-1 bg-foreground/8 [&>div]:bg-culture" /></div></div><div className="mt-5 flex items-center justify-between border-t border-foreground/[0.07] pt-3 font-medium text-xs tracking-normal text-muted-foreground"><span>{integer.format(generation.launches)} launches · {integer.format(generation.swaps)} swaps</span><a href={robinhoodExplorer.address(generation.factory)} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 hover:text-attention">factory <ExternalLink className="size-2.5" /></a></div></article>;
          })}
        </div>
      </section>
      <section className="overflow-hidden rounded-2xl border border-foreground/10 bg-[var(--surface-2)]/86">
        <div className="flex items-center justify-between gap-4 border-b border-foreground/10 px-4 py-3 sm:px-5"><div><p className="font-medium text-xs tracking-normal text-muted-foreground">V1 launch ledger</p><p className="mt-1 text-caption text-muted-foreground">Most recent committed launches across both canonical factories</p></div><span className="font-medium text-xs tracking-normal text-muted-foreground">finality {history.finalityBlocks} blocks</span></div>
        <Button variant="outline" className="m-3" onClick={() => setAscending(!ascending)}>{ascending ? "Oldest first ↑" : "Newest first ↓"}</Button>
        {history.recent.length ? <div className="overflow-x-auto"><table className="w-full min-w-[860px] border-collapse text-left"><thead><tr className="border-b border-foreground/[0.07] font-medium text-xs tracking-normal text-muted-foreground">{["Generation", "Token", "Habitat", "Creator", "Pool activity", "Block", "Evidence"].map((label) => <th key={label} className="px-4 py-3 font-normal">{label}</th>)}</tr></thead><tbody>{[...history.recent].sort((a, b) => (ascending ? 1 : -1) * (a.blockNumber - b.blockNumber)).map((launch) => <tr key={`${launch.generation}:${launch.tokenAddress}`} className="border-b border-foreground/[0.055] text-caption text-muted-foreground last:border-0"><td className="px-4 py-3 font-mono text-xs uppercase text-culture">{launch.generation === "v1-current" ? "V1 current" : "V1 legacy"}</td><td className="px-4 py-3"><p className="font-medium text-foreground/70">{launch.symbol || short(launch.tokenAddress)}</p><p className="mt-0.5 font-mono text-xs text-muted-foreground">{launch.name || short(launch.tokenAddress)}</p></td><td className="px-4 py-3 font-mono text-xs text-attention">{quoteAssetLabel(launch.pairSymbol)}</td><td className="px-4 py-3 font-mono text-xs">{short(launch.deployerAddress)}</td><td className="px-4 py-3 font-mono text-xs">{integer.format(launch.swaps)} swaps · {integer.format(launch.uniqueTraders)} actors</td><td className="px-4 py-3 font-mono text-xs">#{integer.format(launch.blockNumber)}</td><td className="px-4 py-3"><a href={robinhoodExplorer.tx(launch.txHash)} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 font-medium text-xs tracking-normal text-muted-foreground hover:text-attention">transaction <ExternalLink className="size-2.5" /></a></td></tr>)}</tbody></table></div> : <div className="p-10 text-center font-medium text-xs tracking-normal text-muted-foreground">Launch discovery is running · the table remains empty until the first committed range</div>}
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
    <div className="mb-3 flex gap-1.5 overflow-x-auto rounded-2xl border border-foreground/10 bg-[var(--surface-1)]/75 p-2 [scrollbar-width:none]">
      <button type="button" onClick={() => onPair("ALL")}
        className={`cohort-pill ${activePair === "ALL" ? "cohort-pill-active" : ""}`}>
        <span>All PONS</span><small>{cohorts.length} quote assets</small>
      </button>
      {ordered.map((cohort) => (
        <button type="button" key={`${cohort.symbol}:${cohort.address}`} onClick={() => onPair(cohort.symbol)}
          className={`cohort-pill ${activePair === cohort.symbol ? "cohort-pill-active" : ""}`}
          style={activePair === cohort.symbol ? { "--cohort-color": cohort.color } as React.CSSProperties : undefined}>
          <span className="flex items-center gap-1.5">
            <i className="size-1.5 rounded-full" style={{ backgroundColor: cohort.color }} />{quoteAssetLabel(cohort.symbol)}
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
  const [page, setPage] = useState(0);
  const pageCount = Math.max(1, Math.ceil(launches.length / 20));
  const currentPage = Math.min(page, pageCount - 1);
  const visible = launches.slice(currentPage * 20, (currentPage + 1) * 20);
  const centerColor = pair === "ALL" ? "var(--signal)" : cohort?.color ?? "var(--signal)";
  return (
    <section className="pons-field relative min-h-[570px] overflow-hidden rounded-2xl border border-foreground/10 bg-[var(--surface-depth)]/88 lg:min-h-[660px]">
      <div className="absolute inset-x-0 top-0 z-10 flex items-start justify-between gap-4 border-b border-foreground/10 bg-[var(--surface-1)]/82 px-4 py-3 backdrop-blur-md">
        <div>
          <div className="flex items-center gap-2">
            <Orbit className="size-3.5" style={{ color: centerColor }} />
            <p className="font-medium text-caption tracking-normal" style={{ color: centerColor }}>
              {pair === "ALL" ? "PONS protocol field" : `${pair} gravity field`}
            </p>
          </div>
          <p className="mt-1 text-xs text-muted-foreground">Indexed launches grouped by quote terrain. Select a bubble to inspect its evidence.</p>
        </div>
        <div className="text-right">
          <p className="font-medium text-xs tracking-normal text-muted-foreground">Evidence map</p>
          <p className="mt-1 font-mono text-sm" style={{ color: centerColor }}>{visible.length} of {launches.length} records</p>
          {pageCount > 1 ? <div className="mt-1 flex justify-end gap-2 text-xs"><button disabled={currentPage === 0} onClick={() => setPage(currentPage - 1)}>← Previous</button><span>{currentPage + 1}/{pageCount}</span><button disabled={currentPage === pageCount - 1} onClick={() => setPage(currentPage + 1)}>Next →</button></div> : null}
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
          <text x="500" y="339" textAnchor="middle" fill="var(--slate)" fontFamily="IBM Plex Mono, monospace" fontSize="13" letterSpacing="2">
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
              <text x={x} y={y + 3} textAnchor="middle" fill="var(--foreground)" fontFamily="IBM Plex Mono, monospace" fontSize="13" fontWeight="700">
                {launch.symbol.slice(0, 8)}
              </text>
              <text x={x} y={y + radius + 13} textAnchor="middle" fill={active ? launch.pairColor : "var(--slate)"} fontFamily="IBM Plex Mono, monospace" fontSize="13">
                {launch.research?.eligible ? "Current" : "Indexed"} · {compact.format(launch.trades)} trades
              </text>
            </g>
          );
        })}
      </svg>

      <div className="absolute inset-x-3 bottom-3 z-10 flex gap-1.5 overflow-x-auto rounded-md border border-foreground/10 bg-[var(--surface-2)]/88 p-2 backdrop-blur-md [scrollbar-width:none]">
        {visible.length ? visible.map((launch) => (
          <button type="button" key={launch.tokenAddress} onClick={() => onSelect(launch)}
            className={`shrink-0 rounded border px-2.5 py-2 text-left transition ${selected?.tokenAddress === launch.tokenAddress ? "border-foreground/25 bg-foreground/10" : "border-foreground/8 bg-foreground/[0.025] hover:border-foreground/15"}`}>
            <span className="block font-mono text-xs font-semibold" style={{ color: launch.pairColor }}>{launch.symbol}</span>
            <span className="mt-0.5 block font-medium text-xs tracking-normal text-muted-foreground">{launch.uniqueTraders} actors · {launch.phase}</span>
          </button>
        )) : <p className="px-2 py-2 text-xs text-muted-foreground">No launch records are loaded for this habitat in the selected indexed window. Try a wider research window.</p>}
      </div>
    </section>
  );
}

function ScoreRing({ score, color }: { score: number | null; color: string }) {
  const circumference = 2 * Math.PI * 43;
  return (
    <div className="relative size-28 shrink-0">
      <svg viewBox="0 0 100 100" className="size-full -rotate-90">
        <circle cx="50" cy="50" r="43" fill="none" stroke="color-mix(in srgb, var(--foreground) 8%, transparent)" strokeWidth="3" />
        <circle cx="50" cy="50" r="43" fill="none" stroke={color} strokeWidth="3" strokeLinecap="round"
          strokeDasharray={circumference} strokeDashoffset={circumference * (1 - (score ?? 0) / 100)} />
      </svg>
      <div className="absolute inset-0 grid place-items-center text-center">
        <div><span className="text-3xl font-semibold" style={{ color }}>{score ?? "—"}</span><p className="font-medium text-xs tracking-normal text-muted-foreground">{score === null ? "withheld" : "participation"}</p></div>
      </div>
    </div>
  );
}

export function TokenStateTransition({ launch }: { launch: PonsLaunchView }) {
  const transition = launch.stateTransition;
  if (!transition) return null;
  const currentSignal = launch.research?.signal ?? launch.signal;
  const differsFromCurrent = transition.to !== currentSignal;
  const currentGuidance = launch.research?.next;

  const tone =
    differsFromCurrent
      ? "var(--culture)"
      : transition.kind === "recovered" || transition.kind === "strengthened"
      ? "var(--signal)"
      : transition.kind === "deteriorated" || transition.kind === "inactive"
        ? "var(--danger)"
        : transition.kind === "stress-cleared"
          ? "var(--attention)"
          : "var(--culture)";

  return (
    <section
      aria-label="Token state change"
      className="mt-5 overflow-hidden rounded border border-foreground/10 bg-foreground/[0.022]"
    >
      <div
        className="flex flex-wrap items-start justify-between gap-3 border-b border-foreground/8 px-4 py-3"
        style={{ borderLeft: `2px solid ${tone}` }}
      >
        <div>
          <p
            className="font-medium text-xs tracking-normal"
            style={{ color: tone }}
          >
            Recorded state change
          </p>
          <p className="mt-1 text-sm font-semibold text-foreground/85">
            {transition.label}
          </p>
        </div>

        <div className="text-right">
          <p className="font-medium text-xs tracking-normal text-muted-foreground">
            {transition.from} → {transition.to}
          </p>
          <p className="mt-1 font-mono text-xs text-muted-foreground">
            Recorded {relativeTime(transition.observedAt)}
          </p>
        </div>
      </div>

      <div className="px-4 py-4">
        {differsFromCurrent ? (
          <p className="mb-4 rounded border border-attention/15 bg-attention/[0.035] px-3 py-2.5 text-xs leading-5 text-foreground/70">
            The recorded transition ended at <strong>{transition.to.toUpperCase()}</strong>.
            {" "}The current reading is <strong>{currentSignal.toUpperCase()}</strong>.
          </p>
        ) : null}
        {transition.kind === "stress-cleared" ? (
          <div className="mb-4 rounded border border-attention/15 bg-attention/[0.035] px-3 py-2.5 text-xs leading-5 text-foreground/70">
            At that observation, the previously measured stress condition was no longer confirmed.
            The recorded change was <strong className="font-semibold text-attention">not yet a verified recovery</strong>.
          </div>
        ) : null}

        <p className="font-medium text-xs tracking-normal text-muted-foreground">
          What changed at that observation
        </p>

        <ul className="mt-2.5 space-y-2">
          {transition.whatChanged.map((item) => (
            <li key={item} className="flex gap-2 text-xs leading-5 text-foreground/72">
              <span
                aria-hidden="true"
                className="mt-[0.55em] size-1 shrink-0 rounded-full"
                style={{ backgroundColor: tone }}
              />
              <span>{item}</span>
            </li>
          ))}
        </ul>

        <div className="mt-4 border-t border-foreground/8 pt-3">
          <p className="font-medium text-xs tracking-normal text-muted-foreground">
            Watch next · {currentGuidance ? "current reading" : "recorded guidance"}
          </p>
          <p className="mt-2 text-xs leading-5 text-foreground/65">
            {currentGuidance ?? transition.watchNext}
          </p>
        </div>
      </div>
    </section>
  );
}

function LaunchDossier({ launch, saved, onToggleSave }: {
  launch: PonsLaunchView | null;
  saved: boolean;
  onToggleSave: (launch: PonsLaunchView) => void;
}) {
  const [checking, setChecking] = useState(false);
  const [checkNote, setCheckNote] = useState("");
  if (!launch) {
    return (
      <aside className="grid min-h-[420px] place-items-center rounded-2xl border border-foreground/10 bg-[var(--surface-2)]/82 p-7 text-center">
        <div><CircleDot className="mx-auto size-7 text-muted-foreground" /><p className="mt-4 font-medium text-caption tracking-normal text-muted-foreground">Select a launch to inspect its evidence</p></div>
      </aside>
    );
  }
  const phaseColor = launch.phase === "graduated" ? "var(--signal)" : launch.phase === "swept" ? "var(--culture)" : "var(--signal)";
  const gradRate = launch.deployerLaunches ? Math.round(launch.deployerGraduations / launch.deployerLaunches * 100) : 0;
  return (
    <aside data-guide="reading" className="relative overflow-hidden rounded-2xl border border-foreground/10 bg-[var(--surface-2)]/88 p-5 lg:p-6">
      <div className="absolute inset-x-0 top-0 h-px" style={{ background: `linear-gradient(90deg, transparent, ${launch.pairColor}, transparent)` }} />
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <SignalBadge signal={launch.signal} />
            <span className="rounded border px-2 py-1 font-medium text-xs tracking-normal" style={{ color: phaseColor, borderColor: `color-mix(in srgb, ${phaseColor} 34%, transparent)`, backgroundColor: `color-mix(in srgb, ${phaseColor} 7%, transparent)` }}>{launch.phase}</span>
            <span className="font-medium text-xs tracking-normal text-muted-foreground">{quoteAssetLabel(launch.pairSymbol)} habitat</span>
          </div>
          <h2 className="specimen-serif mt-4 break-words text-4xl tracking-[-0.035em] text-foreground/92">{launch.symbol === "—" ? "Token" : launch.symbol}</h2>
          <p className="mt-1 text-sm text-foreground/60">{launch.name}</p>
          <a href={robinhoodExplorer.address(launch.tokenAddress)} target="_blank" rel="noreferrer" className="mt-2 inline-block font-mono text-xs underline text-foreground/65">{short(launch.tokenAddress)} <ExternalLink className="inline size-3" aria-hidden="true" /></a>
          <a href={`https://www.ponsfamily.com/launchpad/${launch.tokenAddress}`} target="_blank" rel="noreferrer" className="ml-3 text-xs underline text-attention">PONS <ExternalLink className="inline size-3" aria-hidden="true" /></a>
        </div>
        <ScoreRing score={launch.research?.score ?? null} color={scoreTone(launch.attentionScore)} />
      </div>

      <TokenStateTransition launch={launch} />

      <Button type="button" variant="outline" size="sm" onClick={() => onToggleSave(launch)}
        className={`mt-4 w-full justify-center font-medium text-xs tracking-normal ${saved ? "border-signal/20 bg-signal/[0.035] text-signal hover:bg-signal/[0.06]" : "border-foreground/10 bg-foreground/[0.025] text-muted-foreground hover:border-attention/25 hover:text-attention"}`}>
        {saved ? <BookmarkCheck /> : <Bookmark />}{saved ? "Saved to research watchlist" : "Save research"}
      </Button>

      <GuidedReading launch={launch} />
      <Button variant="outline" className="mt-3 w-full" disabled={checking} onClick={async () => {
        setChecking(true); setCheckNote("");
        try {
          const response = await fetch(`/api/collector/research?token=${launch.tokenAddress}`, { method: "POST" });
          if (!response.ok) throw new Error("unavailable");
          const result = await response.json();
          setCheckNote(result.status === "recorded" ? "Evidence recorded. The next refresh will show the result." : "Sample is fresh or another check is running. It will appear on refresh.");
        } catch { setCheckNote("Current evidence could not be retrieved. Classification remains withheld."); }
        finally { setChecking(false); }
      }}>{checking ? "Checking current ownership…" : "Refresh ownership evidence"}</Button>
      {checkNote ? <p role="status" className="mt-2 text-xs text-foreground/60">{checkNote}</p> : null}
      <div className="mt-5 rounded border border-foreground/10 bg-foreground/[0.025] px-3.5 py-3">
        <div className="flex items-center justify-between gap-3">
          <p className="font-medium text-xs tracking-normal text-muted-foreground">Short-horizon read</p>
          <span className="rounded border border-foreground/8 px-1.5 py-0.5 font-medium text-xs tracking-normal text-muted-foreground">{launch.confidence} sample confidence</span>
        </div>
        <p className="mt-2 text-xs leading-5 text-muted-foreground">{launch.signalNote}</p>
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
            <p className="font-medium text-xs tracking-normal text-muted-foreground">{label}</p>
            <p className="mt-1 text-lg font-semibold text-foreground/78">{value}</p>
          </div>
        ))}
      </div>

      <div className="mt-5 border-t border-foreground/10 pt-5">
        <div className="flex items-center justify-between gap-3">
          <p className="flex items-center gap-2 font-medium text-xs tracking-normal text-muted-foreground"><GitBranch className="size-3 text-attention" />Creator lineage</p>
          <span className="font-mono text-xs text-muted-foreground">{gradRate}% historical graduation</span>
        </div>
        <div className="mt-3 grid grid-cols-3 gap-2">
          <div className="dossier-cell"><strong>{launch.deployerLaunches}</strong><span>launches</span></div>
          <div className="dossier-cell"><strong>{launch.deployerGraduations}</strong><span>graduated</span></div>
          <div className="dossier-cell"><strong>#{integer.format(launch.blockNumber)}</strong><span>birth block</span></div>
        </div>
        <a href={robinhoodExplorer.address(launch.deployerAddress)} target="_blank" rel="noreferrer"
          className="mt-3 flex items-center justify-between gap-3 rounded border border-foreground/8 bg-foreground/[0.025] px-3 py-2 font-mono text-xs text-muted-foreground transition hover:border-foreground/15 hover:text-muted-foreground">
          <span className="truncate">deployer {short(launch.deployerAddress)}</span><ExternalLink className="size-3" />
        </a>
      </div>

      <div className="mt-5 border-t border-foreground/10 pt-5">
        <p className="flex items-center gap-2 font-medium text-xs tracking-normal text-muted-foreground"><Gauge className="size-3 text-signal" />Signal dimensions</p>
        <div className="mt-3 space-y-3">
          {[
            ["Prior actors", launch.previousUniqueTraders ?? "unknown"],
            ["Indexed creator sells", launch.creatorSellEvents ?? "unknown"],
            ["Window price drawdown", launch.peakDrawdownPercent == null ? "unknown" : `${launch.peakDrawdownPercent.toFixed(1)}%`],
            ["Recent net quote flow", launch.netQuoteFlow == null ? "unknown" : launch.netQuoteFlow < 0 ? "outflow" : "inflow"],
          ].map(([label, value]) => (
            <div key={label as string} className="flex items-center justify-between gap-2">
              <span className="font-medium text-xs tracking-normal text-muted-foreground">{label}</span>
              <span className="text-right font-mono text-xs text-muted-foreground">{value}</span>
            </div>
          ))}
        </div>
      </div>

      <div className="mt-5 space-y-2 border-t border-foreground/10 pt-4 font-medium text-xs tracking-normal text-muted-foreground">
        <a href={robinhoodExplorer.address(launch.tokenAddress)} target="_blank" rel="noreferrer" className="flex items-center justify-between gap-3 hover:text-muted-foreground"><span className="truncate">token {launch.tokenAddress}</span><ExternalLink className="size-3" /></a>
        <a href={robinhoodExplorer.address(launch.curveAddress)} target="_blank" rel="noreferrer" className="flex items-center justify-between gap-3 hover:text-muted-foreground"><span className="truncate">curve {launch.curveAddress}</span><ExternalLink className="size-3" /></a>
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
    launch.confidence, launch.research?.score ?? "withheld", launch.recentTrades, launch.previousTrades,
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

function TokenIdentity({ launch }: { launch: PonsLaunchView }) {
  return <div className="flex items-center gap-3">
    <a href={`https://www.ponsfamily.com/launchpad/${launch.tokenAddress}`} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()} title="Open this token on PONS" aria-label={`Open ${launch.symbol} on PONS`} className="shrink-0"><TokenAvatar token={launch} className="grid size-10 place-items-center overflow-hidden rounded border border-foreground/15 bg-signal/10 font-mono text-xs text-attention" /></a>
    <div className="min-w-0"><p className="truncate text-sm"><strong>{tokenTitle(launch)}</strong> <span className="text-muted-foreground">{tokenText(launch.name)}</span></p>
    <p className="mt-1 font-mono text-caption text-muted-foreground"><a href={robinhoodExplorer.address(launch.tokenAddress)} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()} className="underline hover:text-foreground">{short(launch.tokenAddress)} <ExternalLink className="inline size-3" aria-hidden="true" /></a> · {quoteAssetLabel(launch.pairSymbol)}</p></div>
  </div>;
}

function SignalDesk({ launches, selected, onSelect, state, isSaved, onToggleSave, phase, setPhase, signal, setSignal, sort, setSort }: {
  launches: PonsLaunchView[]; selected: PonsLaunchView | null; onSelect: (launch: PonsLaunchView) => void;
  state: PonsStateResponse; isSaved: (tokenAddress: string) => boolean; onToggleSave: (launch: PonsLaunchView) => void;
  phase: PhaseFilter; setPhase: (value: PhaseFilter) => void; signal: SignalFilter; setSignal: (value: SignalFilter) => void;
  sort: SignalSort; setSort: (value: SignalSort) => void;
}) {
  const [ascending, setAscending] = useState(false);
  const results = useMemo(() => launches.filter((l) => phase === "all" || l.phase === phase)
    .filter((l) => signal === "all" || (signal === "active" ? Boolean(l.research?.eligible) : l.signal === signal))
    .sort((a, b) => {
      const value = (l: PonsLaunchView) => sort === "pulse" ? l.recentTrades : sort === "actors" ? l.recentUniqueTraders : sort === "newest" ? l.blockNumber : sort === "momentum" ? (l.momentumPercent ?? -Infinity) : l.research?.score ?? -1;
      const difference = value(a) === value(b) ? a.tokenAddress.localeCompare(b.tokenAddress) : value(a) - value(b);
      return ascending ? difference : -difference;
    }), [launches, phase, signal, sort, ascending]);
  const changeSort = (key: SignalSort) => { if (key === sort) setAscending(!ascending); else { setSort(key); setAscending(false); } };
  const columns: Array<[string, SignalSort]> = [["Participation", "attention"], ["Indexed trades", "pulse"], ["Change %", "momentum"], ["Actors", "actors"], ["Birth block", "newest"]];
  return <section className="mt-3 grid items-start gap-3 lg:grid-cols-[minmax(0,1fr)_360px]">
    <div className="min-w-0 overflow-hidden rounded-lg border border-foreground/10 bg-[var(--surface-2)]">
      <div className="border-b border-foreground/10 p-4">
        <div className="flex flex-wrap justify-between gap-3"><div><h2 className="text-lg font-semibold">{signal === "active" ? "Current shortlist" : phase === "graduated" ? "Graduated launches" : "Indexed evidence"}</h2><p className="mt-1 text-sm text-foreground/65">{signal === "active" ? "Freshness, persistence and retained participation must pass before a token appears here." : "Browse observed records. Select any token to open its evidence; inclusion is not a current recommendation."}</p></div><Button variant="outline" disabled={!results.length} onClick={() => exportSignalSnapshot(results, state)}>Export {results.length}</Button></div>
        <div className="mt-4 flex flex-wrap gap-2">
          <select aria-label="Evidence filter" value={signal} onChange={(e) => setSignal(e.target.value as SignalFilter)} className="rounded border border-foreground/20 bg-background p-2 text-sm">
            <option value="active">Current shortlist</option><option value="all">All indexed records</option><option value="historical">Historical</option><option value="inactive">Inactive</option><option value="stressed">Stressed</option><option value="unverified">Unverified</option><option value="surging">Expanding</option>
          </select>
          <select aria-label="Phase filter" value={phase} onChange={(e) => setPhase(e.target.value as PhaseFilter)} className="rounded border border-foreground/20 bg-background p-2 text-sm"><option value="all">All phases</option><option value="bonding">Bonding</option><option value="graduated">Graduated</option><option value="swept">Swept</option></select>
          <select aria-label="Sort tokens by" value={sort} onChange={(e) => setSort(e.target.value as SignalSort)} className="rounded border border-foreground/20 bg-background p-2 text-sm">{columns.map(([label, key]) => <option key={key} value={key}>{label}</option>)}</select>
          <Button variant="outline" onClick={() => setAscending(!ascending)} aria-label="Reverse sort direction">{ascending ? "Ascending ↑" : "Descending ↓"}</Button>
        </div>
        {signal !== "active" ? <p className="mt-3 text-sm text-attention">Archive view. Counts describe the indexed windows; they do not imply activity now. Withheld scores are unknown, not zero.</p> : null}
      </div>
      {results.length ? <div className="overflow-x-auto"><table className="w-full min-w-[740px] text-left text-sm"><caption className="p-3 text-left text-xs text-muted-foreground">{results.length} loaded records in the selected habitat and research window.</caption><thead><tr className="border-b border-foreground/10 text-xs text-foreground/60"><th className="p-3">Token / habitat</th><th className="p-3">Reading</th>{columns.map(([label, key]) => <th className="p-3" key={key} aria-sort={sort === key ? ascending ? "ascending" : "descending" : "none"}><button onClick={() => changeSort(key)}>{label} {sort === key ? ascending ? <ArrowUp className="inline size-3" aria-hidden="true" /> : <ArrowDown className="inline size-3" aria-hidden="true" /> : <ArrowUpDown className="inline size-3" aria-hidden="true" />}</button></th>)}</tr></thead>
        <tbody>{results.map((launch) => <tr key={launch.tokenAddress} tabIndex={0} onClick={() => onSelect(launch)} onKeyDown={(e) => { if (e.target === e.currentTarget && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); onSelect(launch); } }} aria-label={`Inspect ${launch.symbol}`} className={`cursor-pointer border-b border-foreground/10 hover:bg-foreground/5 focus-visible:bg-foreground/10 ${selected?.tokenAddress === launch.tokenAddress ? "bg-signal/5" : ""}`}>
          <td className="max-w-72 p-3"><TokenIdentity launch={launch} /></td><td className="p-3"><SignalBadge signal={launch.signal} /></td>
          <td className="p-3 font-mono">{launch.research?.score ?? "—"}</td><td className="p-3 font-mono">{launch.recentTrades} / {launch.previousTrades}</td><td className="p-3 font-mono text-foreground/65">{launch.momentumPercent === null ? "No baseline" : `${launch.momentumPercent}%`}</td><td className="p-3 font-mono">{launch.recentUniqueTraders}</td><td className="p-3 font-mono">{launch.blockNumber}</td>
        </tr>)}</tbody></table></div> : <div className="px-6 py-16 text-center"><h3 className="text-lg">No tokens currently pass these evidence requirements.</h3><p className="mx-auto mt-3 max-w-lg text-sm leading-6 text-foreground/65">{state.mode !== "live" ? "The index is delayed. Current rankings are withheld until coverage catches up." : "Insufficient current evidence is a valid result. Historical records remain available without implying relevance."}</p><Button className="mt-5" variant="outline" onClick={() => { setSignal("all"); setPhase("all"); }}>Browse indexed history</Button></div>}
    </div>
    <div className="lg:sticky lg:top-20"><LaunchDossier launch={selected} saved={selected ? isSaved(selected.tokenAddress) : false} onToggleSave={onToggleSave} /></div>
  </section>;
}

function CohortMatrix({ cohorts, onPair }: { cohorts: PonsPairCohort[]; onPair: (pair: string) => void }) {
  const [order, setOrder] = useState<"recentTrades" | "recentUniqueTraders" | "launches" | "graduations" | "topDeployerShare">("recentTrades");
  const [ascending, setAscending] = useState(false);
  return (
    <section className="mt-3 overflow-hidden rounded-2xl border border-foreground/10 bg-[var(--surface-2)]/82">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-foreground/10 px-4 py-3">
        <div><p className="font-medium text-xs tracking-normal text-attention">Quote-asset ecology</p><p className="mt-1 text-xs text-muted-foreground">Compare PONS launches grouped by quote asset: recent activity, participation, lifecycle maturity, and creator concentration.</p></div>
        <div className="flex gap-2"><select aria-label="Sort habitats" value={order} onChange={(e) => setOrder(e.target.value as typeof order)} className="rounded border border-foreground/20 bg-background p-2 text-xs"><option value="recentTrades">Indexed trades</option><option value="recentUniqueTraders">Actors</option><option value="launches">Launches</option><option value="graduations">Graduations</option><option value="topDeployerShare">Creator concentration</option></select><Button variant="outline" onClick={() => setAscending(!ascending)}>{ascending ? "Ascending ↑" : "Descending ↓"}</Button></div>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[940px] border-collapse text-left">
          <thead><tr className="font-medium text-xs tracking-normal text-muted-foreground">
            <th className="px-4 py-2.5 font-normal">Terrain</th><th className="px-3 py-2.5 font-normal">Signal</th><th className="px-3 py-2.5 font-normal">State</th><th className="px-3 py-2.5 font-normal">Recent / prior</th><th className="px-3 py-2.5 font-normal">Change</th><th className="px-3 py-2.5 font-normal">Recent actors</th><th className="px-3 py-2.5 font-normal">Launches</th><th className="px-3 py-2.5 font-normal">Graduated</th><th className="px-3 py-2.5 font-normal">Top creator</th>
          </tr></thead>
          <tbody className="divide-y divide-white/[0.055]">
            {[...cohorts].sort((a, b) => (ascending ? 1 : -1) * (a[order] - b[order])).map((cohort) => (
              <tr key={`${cohort.symbol}:${cohort.address}`} tabIndex={0} onClick={() => onPair(cohort.symbol)} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); onPair(cohort.symbol); } }} className="cursor-pointer text-xs text-muted-foreground outline-none transition hover:bg-foreground/[0.025] focus-visible:bg-foreground/[0.04]">
                <td className="px-4 py-3"><span className="flex items-center gap-2 font-mono text-caption font-semibold" style={{ color: cohort.color }}><i className="size-1.5 rounded-full bg-current" />{quoteAssetLabel(cohort.symbol)}{cohort.symbol === "NVDA" ? <em className="rounded border border-signal/20 px-1.5 py-0.5 text-xs not-italic tracking-[0.12em]">FLAGSHIP</em> : null}</span></td>
                <td className="px-3 py-3"><SignalBadge signal={cohort.signal} compact /></td>
                <td className="px-3 py-3 font-mono text-xs text-muted-foreground" title="No composite cultural score is inferred from counts">—</td>
                <td className="px-3 py-3 font-mono text-caption">{integer.format(cohort.recentTrades)} <span className="text-muted-foreground">/ {integer.format(cohort.previousTrades)}</span></td>
                <td className="px-3 py-3"><Momentum value={cohort.momentumPercent} current={cohort.recentTrades} previous={cohort.previousTrades} /></td>
                <td className="px-3 py-3 font-mono text-caption">{integer.format(cohort.recentUniqueTraders)}</td>
                <td className="px-3 py-3 font-mono text-caption">{integer.format(cohort.launches)}</td>
                <td className="px-3 py-3 font-mono text-caption">{integer.format(cohort.graduations)} <span className="text-muted-foreground">· {cohort.graduationRate}%</span></td>
                <td className="px-3 py-3 font-mono text-caption">{cohort.topDeployerShare.toFixed(1)}%</td>
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

function PonsTape({ events, onInspect, state }: { events: PonsTapeEvent[]; onInspect: (address: string) => void; state: PonsStateResponse }) {
  const [ascending, setAscending] = useState(false);
  return (
    <section className="overflow-hidden rounded-2xl border border-foreground/10 bg-[var(--surface-1)]/86">
      <div className="grid border-b border-foreground/10 px-4 py-4 sm:grid-cols-[1fr_auto] sm:items-end">
        <div><p className="font-medium text-caption tracking-normal text-signal">Canonical lifecycle tape</p><h2 className="specimen-serif mt-2 text-3xl tracking-[-0.03em] text-foreground/88">Birth, completion, graduation and permanent lock.</h2></div>
        <p className="mt-2 max-w-md text-xs leading-5 text-muted-foreground sm:mt-0 sm:text-right">Routine swaps stay in launch dossiers. The tape preserves state-changing factory events.</p>
      </div>
      <Button variant="outline" className="m-3" onClick={() => setAscending(!ascending)}>{ascending ? "Oldest first ↑" : "Newest first ↓"}</Button>
      <p className="px-4 pb-4 text-sm text-muted-foreground">Events through block {integer.format(state.index.latestIndexedBlock)}. {state.index.liveLagBlocks > 10_000 ? "This is a historical position: event ages describe when they happened, not when the collector last ran." : "Event times reflect the chain; an older event does not by itself mean collection stopped."}</p>
      {events.length ? (
        <div className="divide-y divide-white/[0.06]">
          {[...events].sort((a, b) => (ascending ? 1 : -1) * (a.blockNumber - b.blockNumber)).map((event) => (
            <article key={event.id} className="grid gap-3 px-4 py-3.5 transition hover:bg-foreground/[0.02] sm:grid-cols-[115px_minmax(0,1fr)_140px] sm:items-center">
              <div className="flex items-center gap-2"><span className="size-1.5 rounded-full" style={{ backgroundColor: eventColor[event.eventType] }} /><span className="font-medium text-xs tracking-normal" style={{ color: eventColor[event.eventType] }}>{event.eventType}</span></div>
              <button type="button" onClick={() => onInspect(event.tokenAddress)} aria-label={`Inspect ${event.tokenSymbol === "—" ? short(event.tokenAddress) : event.tokenSymbol} evidence`} className="min-w-0 text-left hover:underline"><p className="truncate text-sm text-foreground/70"><strong className="font-mono text-caption text-foreground/90">{event.tokenSymbol}</strong> <span className="text-muted-foreground">{event.detail}</span></p><p className="mt-1 truncate font-medium text-xs tracking-normal text-muted-foreground">{quoteAssetLabel(event.pairSymbol)} · token {short(event.tokenAddress)}</p></button>
              <a href={robinhoodExplorer.tx(event.txHash)} target="_blank" rel="noreferrer" className="flex items-center justify-between gap-2 font-medium text-xs tracking-normal text-muted-foreground hover:text-muted-foreground sm:justify-end"><span>#{integer.format(event.blockNumber)} · {relativeTime(event.observedAt)}</span><ExternalLink className="size-3" /></a>
            </article>
          ))}
        </div>
      ) : <div className="px-4 py-14 text-center text-sm text-muted-foreground">No lifecycle events have reached the durable index yet.</div>}
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
    <section className="block-seismograph overflow-hidden rounded-2xl border border-foreground/10 bg-[var(--surface-depth)]/92">
      <div className="flex flex-wrap items-start justify-between gap-4 border-b border-foreground/10 px-4 py-4 sm:px-5">
        <div className="flex gap-3">
          <span className="mt-0.5 grid size-8 place-items-center rounded border border-signal/20 bg-signal/[0.045] text-signal"><ScanLine className="size-4" /></span>
          <div><p className="font-medium text-caption tracking-normal text-signal">Collection seismograph</p><p className="mt-1 max-w-2xl text-xs leading-5 text-muted-foreground">A temporal read of cursor lag, indexed activity, metadata coverage, and the most recent collection cycle.</p></div>
        </div>
        <div className="flex items-center gap-2 font-medium text-xs tracking-normal"><span className="rounded border border-foreground/10 bg-foreground/[0.025] px-2 py-1.5" style={{ color: trendTone }}>lag {velocity.trend}</span><span className="rounded border border-foreground/10 bg-foreground/[0.025] px-2 py-1.5" style={{ color: collectorTone }}>{state.collector.status} · {state.collector.strategy ?? state.collector.phase}</span></div>
      </div>
      <div className="grid xl:grid-cols-[minmax(0,1.55fr)_minmax(340px,.75fr)]">
        <div className="border-b border-foreground/10 p-4 sm:p-5 xl:border-b-0 xl:border-r">
          {samples.length >= 2 ? (
            <div className="seismograph-screen relative overflow-hidden rounded border border-foreground/10 bg-[var(--surface-depth)] p-3 sm:p-4">
              <div className="relative z-10 flex items-end justify-between gap-4"><div><p className="font-medium text-xs tracking-normal text-culture">Live-index lag contour</p><p className="mt-1 font-mono text-lg text-foreground/78">{integer.format(latest?.lagBlocks ?? state.index.liveLagBlocks)} <span className="text-xs uppercase tracking-[0.12em] text-muted-foreground">blocks</span></p></div><p className="font-medium text-xs tracking-normal text-muted-foreground">{integer.format(Math.max(...lag))} peak</p></div>
              <svg viewBox="0 0 800 84" preserveAspectRatio="none" className="relative z-10 mt-2 h-24 w-full" role="img" aria-label="PONS live index lag over recent collection samples">
                <defs><linearGradient id="lag-fill" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="var(--culture)" stopOpacity=".22" /><stop offset="1" stopColor="var(--culture)" stopOpacity="0" /></linearGradient></defs>
                <polygon points={`8,84 ${lagTrace} 792,84`} fill="url(#lag-fill)" />
                <polyline points={lagTrace} fill="none" stroke="var(--culture)" strokeWidth="1.5" vectorEffect="non-scaling-stroke" />
              </svg>
              <div className="relative z-10 mt-2 flex items-end justify-between gap-4 border-t border-foreground/[0.07] pt-3"><div><p className="font-medium text-xs tracking-normal text-signal">Observed curve flow</p><p className="mt-1 font-mono text-lg text-foreground/78">{integer.format((latest?.buys ?? 0) + (latest?.sells ?? 0))} <span className="text-xs uppercase tracking-[0.12em] text-muted-foreground">indexed trades</span></p></div><p className="font-medium text-xs tracking-normal text-muted-foreground">{integer.format(latest?.activeTraders ?? 0)} actors</p></div>
              <svg viewBox="0 0 800 84" preserveAspectRatio="none" className="relative z-10 mt-2 h-24 w-full" role="img" aria-label="PONS curve activity over recent collection samples">
                <defs><linearGradient id="flow-fill" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="var(--signal)" stopOpacity=".2" /><stop offset="1" stopColor="var(--signal)" stopOpacity="0" /></linearGradient></defs>
                <polygon points={`8,84 ${flowTrace} 792,84`} fill="url(#flow-fill)" />
                <polyline points={flowTrace} fill="none" stroke="var(--signal)" strokeWidth="1.5" vectorEffect="non-scaling-stroke" />
              </svg>
              <div className="relative z-10 mt-1 flex justify-between font-medium text-xs tracking-normal text-muted-foreground"><span>{earliest ? relativeTime(earliest.observedAt) : "first sample"}</span><span>{samples.length} durable samples</span><span>now</span></div>
            </div>
          ) : (
            <div className="seismograph-screen grid min-h-[365px] place-items-center rounded border border-foreground/10 bg-[var(--surface-depth)] px-6 text-center"><div><ScanLine className="mx-auto size-7 text-signal/30" /><p className="mt-3 font-medium text-caption tracking-normal text-muted-foreground">Telemetry warming</p><p className="mt-2 max-w-sm text-xs leading-5 text-muted-foreground">Two successful collection samples are needed to calculate cursor velocity and render the temporal trace.</p></div></div>
          )}
        </div>
        <div className="p-4 sm:p-5">
          <div className="grid grid-cols-2 gap-px overflow-hidden rounded border border-foreground/10 bg-foreground/10">
            <div className="bg-[var(--surface-2)] p-3.5"><p className="font-medium text-xs tracking-normal text-muted-foreground">Index velocity</p><p className="mt-2 font-mono text-base text-foreground/78">{velocity.indexedBlocksPerMinute === null ? "—" : compact.format(velocity.indexedBlocksPerMinute)}<span className="ml-1 text-xs uppercase text-muted-foreground">blk/min</span></p></div>
            <div className="bg-[var(--surface-2)] p-3.5"><p className="font-medium text-xs tracking-normal text-muted-foreground">Net closure</p><p className="mt-2 font-mono text-base" style={{ color: trendTone }}>{velocity.netCatchupPerMinute === null ? "—" : `${velocity.netCatchupPerMinute > 0 ? "+" : ""}${compact.format(velocity.netCatchupPerMinute)}`}<span className="ml-1 text-xs uppercase text-muted-foreground">blk/min</span></p></div>
            <div className="bg-[var(--surface-2)] p-3.5"><p className="font-medium text-xs tracking-normal text-muted-foreground">Projected live edge</p><p className="mt-2 flex items-center gap-1.5 font-mono text-base text-foreground/78"><TimerReset className="size-3.5 text-culture" />{catchupLabel(velocity.estimatedCatchupMinutes)}</p></div>
            <div className="bg-[var(--surface-2)] p-3.5"><p className="font-medium text-xs tracking-normal text-muted-foreground">Latest cycle</p><p className="mt-2 font-mono text-base text-foreground/78">{cycleDuration(state.collector.durationMs)}</p></div>
          </div>
          <div className="mt-3 rounded border border-foreground/10 bg-foreground/[0.025] p-4">
            <div className="flex items-end justify-between gap-4"><div><p className="font-medium text-xs tracking-normal text-muted-foreground">Identity coverage</p><p className="mt-1 text-xs text-muted-foreground">Resolved token names and symbols across the committed launch set.</p></div><strong className="font-mono text-xl text-attention">{state.coverage.metadataPercent.toFixed(1)}%</strong></div>
            <div className="mt-3 flex h-1.5 overflow-hidden rounded bg-foreground/8"><span className="h-full bg-attention" style={{ width: `${state.coverage.metadataPercent}%` }} /><span className="h-full bg-culture/35" style={{ width: `${metadataRemainder}%` }} /></div>
            <div className="mt-3 grid grid-cols-3 gap-2 font-medium text-xs tracking-normal text-muted-foreground"><span>resolved <strong className="block pt-1 text-caption text-foreground/65">{integer.format(state.coverage.metadataResolved)}</strong></span><span>pending <strong className="block pt-1 text-caption text-foreground/65">{integer.format(state.coverage.metadataPending)}</strong></span><span>failed <strong className="block pt-1 text-caption text-foreground/65">{integer.format(state.coverage.metadataFailed)}</strong></span></div>
          </div>
          <div className="mt-3 grid grid-cols-3 gap-2 rounded border border-foreground/10 bg-foreground/[0.018] p-3 font-mono"><span className="text-xs uppercase tracking-[0.1em] text-muted-foreground">live blocks<strong className="mt-1 block text-caption text-muted-foreground">{integer.format(state.collector.liveBlocksProcessed)}</strong></span><span className="text-xs uppercase tracking-[0.1em] text-muted-foreground">archive blocks<strong className="mt-1 block text-caption text-muted-foreground">{integer.format(state.collector.historicalBlocksProcessed)}</strong></span><span className="text-xs uppercase tracking-[0.1em] text-muted-foreground">records<strong className="mt-1 block text-caption text-muted-foreground">{integer.format(state.collector.recordsProcessed)}</strong></span></div>
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
      <BlockSeismograph state={state} />
      <section className="grid gap-px overflow-hidden rounded-2xl border border-foreground/10 bg-foreground/[0.07] md:grid-cols-2 xl:grid-cols-4">
        {sourceCards.map(({ icon: Icon, label, value, note, tone }) => (
          <div key={label} className="bg-[var(--surface-2)] p-5">
            <div className="flex items-center gap-2"><Icon className="size-3.5" style={{ color: tone }} /><p className="font-medium text-xs tracking-normal text-muted-foreground">{label}</p></div>
            <p className="mt-3 font-mono text-sm text-foreground/75">{value}</p><p className="mt-1 text-caption leading-4 text-muted-foreground">{note}</p>
          </div>
        ))}
      </section>
      <section className="grid gap-3 lg:grid-cols-[1.1fr_.9fr]">
        <div className="rounded-2xl border border-foreground/10 bg-[var(--surface-2)]/86 p-5">
          <div className="flex items-start justify-between gap-4"><div><p className="font-medium text-xs tracking-normal text-culture">Historical reconstruction</p><p className="mt-1 text-xs text-muted-foreground">The live edge is collected first; immutable history advances independently behind it.</p></div><strong className="font-mono text-lg text-culture">{state.index.historicalProgress.toFixed(1)}%</strong></div>
          <Progress value={state.index.historicalProgress} className="mt-5 h-1.5 bg-foreground/8 [&>div]:bg-culture" />
          <div className="mt-3 flex items-center justify-between gap-3 font-medium text-xs tracking-normal text-muted-foreground"><span>floor #{integer.format(state.index.backfillFloor)}</span><span>cursor #{integer.format(state.index.backfillNextBlock)}</span></div>
          <div className="mt-6 grid grid-cols-2 gap-px overflow-hidden rounded border border-foreground/10 bg-foreground/10">
            <div className="bg-[var(--surface-3)] p-3"><p className="font-medium text-xs tracking-normal text-muted-foreground">Observation window</p><p className="mt-1 text-lg font-semibold text-foreground/75">~{state.window.approximateHours}h</p></div>
            <div className="bg-[var(--surface-3)] p-3"><p className="font-medium text-xs tracking-normal text-muted-foreground">Score model</p><p className="mt-1 font-mono text-caption text-foreground/65">{state.methodology.scoreVersion}</p></div>
          </div>
        </div>
        <div className="rounded-2xl border border-foreground/10 bg-[var(--surface-2)]/86 p-5">
          <div className="flex items-center justify-between gap-4"><p className="font-medium text-xs tracking-normal text-signal">Method discipline</p><button type="button" onClick={onWake} disabled={wakeState === "sending"} className="flex items-center gap-1.5 font-medium text-xs tracking-normal text-signal/65 hover:text-signal disabled:opacity-40"><RefreshCw className={`size-3 ${wakeState === "sending" ? "animate-spin" : ""}`} />{wakeState === "accepted" ? "dispatched" : "force cycle"}</button></div>
          <div className="mt-4 space-y-3">
            {state.methodology.caveats.map((caveat) => <p key={caveat} className="flex gap-3 text-xs leading-5 text-muted-foreground"><CheckCircle2 className="mt-0.5 size-3.5 shrink-0 text-signal/60" />{caveat}</p>)}
          </div>
          <a href={robinhoodExplorer.address(state.index.factory)} target="_blank" rel="noreferrer" className="mt-5 flex items-center justify-between gap-3 rounded border border-foreground/8 bg-foreground/[0.025] px-3 py-2 font-medium text-xs tracking-normal text-muted-foreground hover:border-foreground/15 hover:text-muted-foreground"><span>Inspect canonical PONS V2 factory</span><ExternalLink className="size-3" /></a>
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
  onRefreshPassport: (forceIdentitySync?: boolean) => Promise<void>;
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
      <section className="network-manifesto relative overflow-hidden rounded-2xl border border-foreground/10 bg-[var(--surface-1)]/90">
        <div className="relative z-10 grid min-h-[340px] gap-8 p-5 sm:p-7 lg:grid-cols-[1.08fr_.92fr] lg:p-9">
          <div className="flex flex-col justify-between">
            <div>
              <div className="flex flex-wrap items-center gap-2 font-medium text-xs tracking-normal"><span className="text-signal">Network thesis</span><span className="text-muted-foreground">/</span><span className="text-muted-foreground">PONS intelligence on Robinhood Chain</span></div>
              <h2 className="specimen-serif mt-5 max-w-3xl text-4xl leading-[1.02] tracking-[-0.04em] text-foreground/92 sm:text-5xl xl:text-6xl">Read the market forming <em className="font-normal text-signal">before</em> the chart explains it.</h2>
              <p className="mt-5 max-w-2xl text-sm leading-7 text-muted-foreground">Memetic State maps how token launches gather attention around onchain stock terrains. PONS is the first intelligence universe; NVDA is the flagship habitat—not the boundary of the product.</p>
            </div>
            <div className="mt-8 flex flex-wrap items-center gap-3">
              <button type="button" onClick={onOpenSignals} className="inline-flex items-center gap-2 rounded border border-signal/35 bg-signal/10 px-4 py-2.5 font-medium text-xs tracking-normal text-signal transition hover:bg-signal/15"><Activity className="size-3.5" />Open live signals</button>
              <p className="font-medium text-xs tracking-normal text-muted-foreground">Independent research · no ranking can be bought</p>
            </div>
          </div>
          <div className="state-circuit self-stretch rounded border border-foreground/10 bg-[var(--surface-depth)]/76 p-4 sm:p-5">
            <div className="flex items-center justify-between gap-3"><p className="font-medium text-xs tracking-normal text-muted-foreground">Live proof surface</p><span className="inline-flex items-center gap-1.5 font-medium text-xs tracking-normal" style={{ color: modeTone(state.mode) }}><i className="size-1.5 rounded-full bg-current" />{state.mode}</span></div>
            <div className="mt-6 grid grid-cols-2 gap-px overflow-hidden rounded border border-foreground/10 bg-foreground/10">
              <div className="bg-[var(--surface-2)] p-4"><p className="network-kicker">launches mapped</p><strong>{integer.format(state.summary.launches)}</strong></div>
              <div className="bg-[var(--surface-2)] p-4"><p className="network-kicker">curve trades</p><strong>{integer.format(state.summary.trades)}</strong></div>
              <div className="bg-[var(--surface-2)] p-4"><p className="network-kicker">creator breadth</p><strong>{integer.format(state.summary.uniqueDeployers)}</strong></div>
              <div className="bg-[var(--surface-2)] p-4"><p className="network-kicker">stock habitats</p><strong>{integer.format(state.summary.stockPairs)}</strong></div>
            </div>
            <div className="mt-5 space-y-3">
              {[{ label: "Canonical event coverage", value: state.index.historicalProgress, tone: "var(--culture)" }, { label: "Resolved token identity", value: state.coverage.metadataPercent, tone: "var(--attention)" }].map((metric) => <div key={metric.label}><div className="mb-1.5 flex items-center justify-between font-medium text-xs tracking-normal text-muted-foreground"><span>{metric.label}</span><span className="text-muted-foreground">{metric.value.toFixed(1)}%</span></div><div className="h-1 overflow-hidden rounded bg-foreground/8"><span className="block h-full" style={{ width: `${clampUi(metric.value)}%`, backgroundColor: metric.tone }} /></div></div>)}
            </div>
            <p className="mt-5 border-t border-foreground/8 pt-4 text-caption leading-5 text-muted-foreground">The commercial moat is accumulated, queryable market memory—not a one-off dashboard or a proprietary mystery score.</p>
          </div>
        </div>
      </section>

      <ResearchPassport passport={passport} localWatchCount={localWatchCount} onRefresh={onRefreshPassport} onSyncWatches={onSyncWatches} />

      <PremiumInterpretationPanel passport={passport} windowBlocks={windowBlocks} />

      <section className="rounded-2xl border border-foreground/10 bg-[var(--surface-2)]/86 p-5 sm:p-7">
        <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-end"><div><p className="font-medium text-xs tracking-normal text-signal">State circuit</p><h3 className="specimen-serif mt-2 text-3xl tracking-[-0.03em] text-foreground/88">Evidence becomes a decision product.</h3></div><p className="max-w-md text-xs leading-5 text-muted-foreground sm:text-right">Every commercial layer can be traced back to open, canonical observations.</p></div>
        <div className="mt-6 grid gap-px overflow-hidden rounded border border-foreground/10 bg-foreground/[0.08] md:grid-cols-2 xl:grid-cols-4">
          {circuit.map(({ index, label, title, copy, tone, icon: Icon }) => <article key={label} className="circuit-station bg-[var(--surface-1)] p-5" style={{ "--station-tone": tone } as React.CSSProperties}><div className="flex items-center justify-between"><span className="font-mono text-xs tracking-[0.18em] text-muted-foreground">{index}</span><Icon className="size-4" style={{ color: tone }} /></div><p className="mt-8 font-medium text-xs tracking-normal" style={{ color: tone }}>{label}</p><h4 className="mt-2 text-base font-semibold text-foreground/76">{title}</h4><p className="mt-2 text-caption leading-5 text-muted-foreground">{copy}</p></article>)}
        </div>
      </section>

      <section id="founding-researchers" className="relative overflow-hidden rounded-2xl border border-signal/16 bg-[var(--surface-1)]/92 p-5 sm:p-7">
        <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-signal/70 to-transparent" />
        <div className="grid gap-8 lg:grid-cols-[.82fr_1.18fr] lg:items-start">
          <div>
            <p className="font-medium text-xs tracking-normal text-signal">Founding research cohort · 10 seats</p>
            <h3 className="specimen-serif mt-3 text-4xl leading-[1.04] tracking-[-0.035em] text-foreground/90">Help turn PONS monitoring into a workflow you rely on.</h3>
            <p className="mt-4 max-w-xl text-sm leading-7 text-muted-foreground">We are recruiting four active researchers, three launch teams, and three ecosystem or data builders. Founding partners get direct input into alerts, history, exports and coverage priorities. Canonical evidence stays public and no ranking can be bought.</p>
            <div className="mt-5 grid gap-2 sm:grid-cols-3 lg:grid-cols-1 xl:grid-cols-3">
              {["Use the observatory twice", "Show us what you still check manually", "Shape one dependable research action"].map((item, index) => <div key={item} className="rounded border border-foreground/8 bg-foreground/[0.018] p-3"><span className="font-mono text-xs text-signal/55">0{index + 1}</span><p className="mt-2 text-caption leading-4 text-muted-foreground">{item}</p></div>)}
            </div>
          </div>
          {partnerState === "accepted" ? (
            <div className="grid min-h-[320px] place-items-center rounded border border-signal/18 bg-signal/[0.035] p-8 text-center">
              <div><CheckCircle2 className="mx-auto size-8 text-signal" /><p className="mt-5 font-medium text-xs tracking-normal text-signal">Application received</p><h4 className="specimen-serif mt-3 text-3xl text-foreground/86">You’re on the founding research list.</h4><p className="mx-auto mt-3 max-w-md text-xs leading-6 text-muted-foreground">We’ll use the contact you provided to arrange a short workflow session. Until then, save a few launches and note what Memetic State should watch while you are away.</p><button type="button" onClick={onOpenWatchlist} className="mt-6 inline-flex items-center gap-2 rounded border border-attention/25 bg-attention/[0.05] px-4 py-2.5 font-medium text-xs tracking-normal text-attention"><Bookmark className="size-3.5" />Open watchlist</button></div>
            </div>
          ) : (
            <form onSubmit={submitPartner} className="rounded border border-foreground/10 bg-[var(--surface-depth)]/76 p-4 sm:p-5">
              <div className="flex items-center justify-between gap-3"><p className="font-medium text-xs tracking-normal text-muted-foreground">Apply to the cohort</p><span className="font-medium text-xs tracking-normal text-muted-foreground">No wallet required</span></div>
              <label className="mt-5 block"><span className="mb-2 block font-medium text-xs tracking-normal text-muted-foreground">Your role</span><Select value={partnerPersona} onValueChange={setPartnerPersona}><SelectTrigger className="w-full border-foreground/10 bg-foreground/[0.025] text-foreground/60"><SelectValue /></SelectTrigger><SelectContent className="border-foreground/10 bg-[var(--surface-popover)] text-foreground/75"><SelectItem value="researcher">Researcher or trader</SelectItem><SelectItem value="launch-team">PONS launch team</SelectItem><SelectItem value="ecosystem-builder">Ecosystem or data builder</SelectItem></SelectContent></Select></label>
              <label className="mt-4 block"><span className="mb-2 block font-medium text-xs tracking-normal text-muted-foreground">X handle or email</span><Input required minLength={3} maxLength={120} value={partnerContact} onChange={(event) => setPartnerContact(event.target.value)} placeholder="@handle or name@example.com" className="border-foreground/10 bg-foreground/[0.025] text-foreground/70 placeholder:text-muted-foreground" /></label>
              <label className="mt-4 block"><span className="mb-2 block font-medium text-xs tracking-normal text-muted-foreground">What do you monitor manually today?</span><textarea required minLength={12} maxLength={800} rows={5} value={partnerWorkflow} onChange={(event) => setPartnerWorkflow(event.target.value)} placeholder="The launch, habitat or activity change you keep checking—and what would make an alert useful." className="w-full resize-y rounded-md border border-foreground/10 bg-foreground/[0.025] px-3 py-2.5 text-xs leading-5 text-foreground/70 outline-none transition placeholder:text-muted-foreground focus:border-signal/30" /></label>
              <input tabIndex={-1} autoComplete="off" aria-hidden="true" name="website" className="hidden" />
              <Button type="submit" disabled={partnerState === "sending"} className="mt-4 w-full border border-signal/30 bg-signal/10 font-medium text-xs tracking-normal text-signal hover:bg-signal/15"><Users />{partnerState === "sending" ? "Submitting" : partnerState === "failed" ? "Retry application" : "Join founding research cohort"}</Button>
              <p className="mt-3 text-center font-medium text-xs tracking-normal text-muted-foreground">Used only to contact you about Memetic State research access</p>
            </form>
          )}
        </div>
      </section>
    </div>
  );
}

export function PonsObservatory({ experience = "observe" }: { experience?: ObservatoryExperience }) {
  const {
    authenticated: privyAuthenticated,
    identityVersion,
    authFetch,
  } = useMemeticAuth();
  const [state, setState] = useState<PonsStateResponse | null>(null);
  const factoryStream = useFactoryStream(state?.factoryLive);
  const [activePair, setActivePair] = useState("ALL");
  const [selectedAddress, setSelectedAddress] = useState<string | null>(null);
  const [selectedIdentity, setSelectedIdentity] = useState<TokenSearchResult | null>(null);
  const [dossierOpen, setDossierOpen] = useState(false);
  const [pulseSelection, setPulseSelection] = useState<PulseSelection | null>(null);
  const [factoryEvent, setFactoryEvent] = useState<PonsTapeEvent | null>(null);
  const [signalFilter, setSignalFilter] = useState<SignalFilter>("active");
  const [phaseFilter, setPhaseFilter] = useState<PhaseFilter>("all");
  const [signalSort, setSignalSort] = useState<SignalSort>("attention");
  const [activeView, setActiveView] = useState<ObservatoryView>(experience === "research" ? "premium" : experience === "saved" ? "watchlist" : "signals");
  const [windowBlocks, setWindowBlocks] = useState<number>(DEFAULT_PONS_STATE_WINDOW);
  const [preferencesReady, setPreferencesReady] = useState(false);
  const [watchlist, setWatchlist] = useState<WatchEntry[]>([]);
  const [watchlistReady, setWatchlistReady] = useState(false);
  const [watchTransitions, setWatchTransitions] = useState<Record<string, PonsTokenStateTransition>>({});
  const [watchTransitionError, setWatchTransitionError] = useState<string | null>(null);
  const [passport, setPassport] = useState<PassportResponse | null>(null);
  const passportRequest = useRef(0);
  const [serverWatchesLoaded, setServerWatchesLoaded] = useState(false);
  const [watchSyncMessage, setWatchSyncMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const stateRequest = useRef<AbortController | null>(null);
  const stateBusy = useRef(false);
  const [copyState, setCopyState] = useState<"idle" | "copied" | "failed">("idle");
  const [wakeState, setWakeState] = useState<"idle" | "sending" | "accepted" | "failed">("idle");

  useEffect(() => {
    const restoreLocation = () => {
      const requested = parseObservatoryLocation(window.location.search, experience);
      setWindowBlocks(requested.windowBlocks);
      setActiveView(requested.view);
      setActivePair(requested.pair);
      setSelectedAddress(requested.token);
      if (requested.token) setSignalFilter("all");
      setDossierOpen(requested.openDossier);
      setPreferencesReady(true);
    };
    const timer = window.setTimeout(restoreLocation, 0);
    window.addEventListener("popstate", restoreLocation);
    return () => { window.clearTimeout(timer); window.removeEventListener("popstate", restoreLocation); };
  }, [experience]);

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

  const watchedAddresses = watchlist.map((entry) => entry.tokenAddress.toLowerCase()).sort().join(",");
  useEffect(() => {
    if (!watchedAddresses || (experience !== "saved" && activeView !== "watchlist")) return;
    const controller = new AbortController();
    const addresses = watchedAddresses.split(",");
    const batches = Array.from({ length: Math.ceil(addresses.length / 50) }, (_, index) => addresses.slice(index * 50, index * 50 + 50));
    void Promise.all(batches.map(async (batch) => {
      const response = await fetch(`/api/state-changes?tokens=${encodeURIComponent(batch.join(","))}`, { cache: "no-store", signal: controller.signal });
      if (!response.ok) throw new Error("Saved state changes are temporarily unavailable.");
      return response.json() as Promise<{ changes: { tokenAddress: string; transition: PonsTokenStateTransition }[]; partial: boolean }>;
    })).then((pages) => {
      if (controller.signal.aborted) return;
      setWatchTransitions(Object.fromEntries(pages.flatMap((page) => page.changes.map((change) => [change.tokenAddress.toLowerCase(), change.transition]))));
      setWatchTransitionError(pages.some((page) => page.partial) ? "Some saved state changes could not be read. Their absence is not evidence of stability." : null);
    }).catch(() => { if (!controller.signal.aborted) setWatchTransitionError("Saved state changes could not refresh. Any dates shown belong to the last returned evidence."); });
    return () => controller.abort();
  }, [watchedAddresses, experience, activeView, state?.generatedAt]);

  const refreshPassport = useCallback(async (forceIdentitySync = false) => {
    const requestId = ++passportRequest.current;
    const path = forceIdentitySync ? "/api/entitlements/me?sync=1" : "/api/entitlements/me";
    const response = await authFetch(path, { headers: { accept: "application/json" } });
    const next = await response.json() as PassportResponse;
    if (!response.ok && !("authenticated" in next)) throw new Error("passport_unavailable");
    if (requestId === passportRequest.current) setPassport(next);
  }, [authFetch]);

  useEffect(() => {
    ++passportRequest.current;
    setPassport(null);
    const timer = window.setTimeout(() => {
      setServerWatchesLoaded(false);
      void refreshPassport(privyAuthenticated).catch(() => setPassport(null));
    }, 0);
    return () => window.clearTimeout(timer);
  }, [identityVersion, privyAuthenticated, refreshPassport]);

  useEffect(() => {
    if (!watchlistReady || !passport?.authenticated || serverWatchesLoaded) return;
    let active = true;
    void authFetch("/api/watchtower/watches", { headers: { accept: "application/json" } })
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
  }, [authFetch, passport?.authenticated, serverWatchesLoaded, watchlistReady]);

  const persistWatch = useCallback(async (entry: WatchEntry) => {
    if (!passport?.authenticated) return false;
    const response = await authFetch("/api/watchtower/watches", {
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
  }, [authFetch, passport?.authenticated]);

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
    stateRequest.current?.abort();
    const request = new AbortController();
    stateRequest.current = request;
    stateBusy.current = true;
    setIsRefreshing(true);
    try {
      const response = await fetch(`/api/pons-state?window=${windowBlocks}&pair=${encodeURIComponent(activePair)}&phase=${phaseFilter}${selectedAddress ? `&token=${encodeURIComponent(selectedAddress)}` : ""}`, { signal: request.signal, cache: "no-store", headers: { accept: "application/json" } });
      if (!response.ok) throw new Error("The PONS evidence endpoint has not become available yet.");
      const next = await response.json() as PonsStateResponse;
      if (request.signal.aborted) return;
      setState(next);
      if (watchlistReady) {
        setWatchlist((current) => reconcileWatchlist(current, next.launches, next.generatedAt).entries);
      }
      setError(null);
      setActivePair((current) => current === "ALL" || next.cohorts.some((cohort) => cohort.symbol === current) ? current : "ALL");
    } catch (cause) {
      if (request.signal.aborted) return;
      setError(cause instanceof Error ? cause.message : "PONS state unavailable");
    } finally {
      if (!request.signal.aborted) setIsRefreshing(false);
      if (stateRequest.current === request) stateBusy.current = false;
    }
  }, [watchlistReady, windowBlocks, selectedAddress, activePair, phaseFilter]);

  useEffect(() => {
    if (!preferencesReady) return;
    const initial = window.setTimeout(() => void refresh(), 0);
    const timer = window.setInterval(() => { if (!stateBusy.current && document.visibilityState === "visible") void refresh(); }, 30_000);
    return () => {
      window.clearTimeout(initial);
      window.clearInterval(timer);
      stateRequest.current?.abort();
    };
  }, [preferencesReady, refresh]);

  useEffect(() => {
    // Collection proceeds independently of expensive dashboard queries.
    const requests = new Map<string, AbortController>();
    const lastDispatch = new Map<string, number>();
    const dispatch = async (lane: string, cadence: number) => {
      if (document.visibilityState !== "visible" || requests.has(lane) || Date.now() - (lastDispatch.get(lane) ?? 0) < cadence) return;
      const request = new AbortController();
      requests.set(lane, request); lastDispatch.set(lane, Date.now());
      const timeout = window.setTimeout(() => request.abort(), 10_000);
      try { await fetch(`/api/collector/${lane}`, { method: "POST", signal: request.signal }); }
      catch { /* The evidence view retains collection status and errors. */ }
      finally { window.clearTimeout(timeout); requests.delete(lane); }
    };
    const heartbeat = () => { void dispatch("heartbeat", 20_000); };
    heartbeat();
    const primary = window.setInterval(heartbeat, 20_000);
    const delays: number[] = [];
    const intervals: number[] = [];
    ["metadata", "research", "evidence"].forEach((lane, index) => {
      delays.push(window.setTimeout(() => {
        void dispatch(lane, 90_000);
        intervals.push(window.setInterval(() => void dispatch(lane, 90_000), 90_000));
      }, 8_000 + index * 24_000));
    });
    document.addEventListener("visibilitychange", heartbeat);
    return () => {
      window.clearInterval(primary); delays.forEach(window.clearTimeout); intervals.forEach(window.clearInterval);
      requests.forEach((request) => request.abort()); document.removeEventListener("visibilitychange", heartbeat);
    };
  }, []);

  useEffect(() => {
    if (!preferencesReady) return;
    const url = new URL(window.location.href);
    if (experience === "observe") {
      url.searchParams.set("view", activeView);
      url.searchParams.set("pair", activePair);
      url.searchParams.set("window", String(windowBlocks));
    } else {
      url.searchParams.delete("view");
    }
    if (selectedAddress) url.searchParams.set("token", selectedAddress);
    else url.searchParams.delete("token");
    const query = url.searchParams.toString();
    window.history.replaceState(null, "", `${url.pathname}${query ? `?${query}` : ""}`);
  }, [activePair, activeView, experience, preferencesReady, selectedAddress, windowBlocks]);

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
  const filteredLaunches = useMemo(() => launchesForPair(state?.launches ?? [], activePair), [state, activePair]);
  const selected = useMemo(() => {
    const launch = selectedLaunch(state?.launches ?? [], selectedAddress);
    const identity = selectedIdentity?.tokenAddress === selectedAddress ? selectedIdentity : null;
    return launch && identity ? { ...launch, name: tokenText(launch.name) ?? identity.name ?? launch.name,
      symbol: tokenText(launch.symbol) ?? identity.symbol ?? launch.symbol, imageUrl: identity.imageUrl ?? launch.imageUrl } : launch;
  }, [state, selectedAddress, selectedIdentity]);

  const inspectSearchResult = (token: TokenSearchResult) => {
    setSelectedIdentity(token); setFactoryEvent(null); setActivePair("ALL");
    setPhaseFilter("all"); setSignalFilter("all"); setActiveView("signals");
    setSelectedAddress(token.tokenAddress); setDossierOpen(true);
  };

  const choosePair = (pair: string) => {
    setActivePair(pair);
    const selection = pairSelection(state?.launches ?? [], pair);
    setSelectedAddress(selection.address);
    setSignalFilter(selection.filter);
    setPhaseFilter("all");
  };

  const inspectLaunch = (launch: PonsLaunchView) => { setFactoryEvent(null); setSelectedAddress(launch.tokenAddress); setDossierOpen(true); };
  const inspectLeader = (address: string) => {
    const launch = state?.launches.find((item) => item.tokenAddress === address);
    if (launch) setActivePair(launch.pairSymbol);
    setFactoryEvent(factoryStream.feed?.events.find((event) => event.tokenAddress === address) ?? null);
    setSelectedAddress(address.toLowerCase());
    setDossierOpen(true);
  };
  const explorePair = (pair: string) => { choosePair(pair); setActiveView("atlas"); window.scrollTo({ top: 0, behavior: "smooth" }); };
  const explorePulse = (metric: PulseMetricKey) => {
    if (!state) return;
    setPulseSelection({ metric, toBlock: state.index.latestIndexedBlock, displayedCount: (metric === "actors" ? state.pulse.uniqueTraders : state.pulse[metric]).current });
  };
  const browseGeneration = (id: "v2" | "v1-current" | "v1-legacy") => {
    if (id === "v2") { setActivePair("ALL"); setSignalFilter("all"); setPhaseFilter("all"); setActiveView("signals"); }
    else setActiveView("history");
    window.setTimeout(() => document.querySelector(id === "v2" ? '[data-guide="reading"]' : `[data-generation="${id}"]`)?.scrollIntoView({ behavior: "smooth", block: "center" }), 50);
  };
  const exploreMetric = (label: string) => {
    setActivePair("ALL"); setSignalFilter("all"); setPhaseFilter(label === "Graduations" ? "graduated" : "all");
    setSignalSort(label === "Curve trades" ? "pulse" : label === "Creator breadth" ? "actors" : "newest");
    setActiveView(label === "Stock terrains" ? "atlas" : label === "Index lag" ? "evidence" : "signals");
    window.setTimeout(() => document.querySelector('[data-guide="reading"]')?.scrollIntoView({ behavior: "smooth", block: "start" }), 50);
  };

  const isSaved = (tokenAddress: string) => watchlist.some((entry) => entry.tokenAddress === tokenAddress.toLowerCase());
  const toggleWatch = (launch: PonsLaunchView) => {
    const tokenAddress = launch.tokenAddress.toLowerCase();
    const existing = watchlist.find((entry) => entry.tokenAddress === tokenAddress);
    if (existing) {
      setWatchlist((current) => current.filter((entry) => entry.tokenAddress !== tokenAddress));
      if (passport?.authenticated) void authFetch("/api/watchtower/watches", { method: "DELETE", headers: { "content-type": "application/json" }, body: JSON.stringify({ tokenAddress }) }).then(() => refreshPassport()).catch(() => undefined);
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
    if (passport?.authenticated) void authFetch("/api/watchtower/watches", { method: "DELETE", headers: { "content-type": "application/json" }, body: JSON.stringify({ tokenAddress }) }).then(() => refreshPassport()).catch(() => undefined);
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
    setDossierOpen(true);
  };
  const unreadWatchAlerts = watchlist.reduce((total, entry) => total + entry.alerts.filter((item) => !item.read).length, 0);

  return (
    <div className="workspace-shell">
      <div>
        <AppHeader active={experience} passport={passport} onAccount={() => {
          if (experience !== "observe") { window.location.assign("/app/observe?view=network#passport"); return; }
          setActiveView("network"); window.setTimeout(() => document.getElementById("passport")?.scrollIntoView({ behavior: "smooth", block: "start" }), 50);
        }} />
        <main id="workspace-content" className="workspace-main" data-experience={experience}>
        <div className="workspace-heading">
          <div><p className="font-medium text-xs tracking-normal text-attention">{experience === "observe" ? "Full evidence workspace" : experience === "research" ? "Holder workspace" : "Your research memory"}</p><h1 className="specimen-serif mt-2 text-3xl sm:text-4xl">{experience === "observe" ? "Observatory" : experience === "research" ? "Research" : "Saved"}</h1><p className="workspace-description">{experience === "observe" ? "Follow the signals. Open the evidence. Form your own reading." : experience === "research" ? "Turn a question into a dated, evidence-backed reading." : "Watch your tokens, revisit your questions, and compare saved evidence."}</p></div>
          <div className="flex flex-wrap items-center gap-2">
            <Button type="button" variant="outline" size="icon-sm" onClick={() => void copyView()} aria-label="Copy current page link" title="Copy current view"
              className="border-foreground/10 bg-foreground/[0.025] text-muted-foreground hover:bg-foreground/[0.06] hover:text-foreground/75"><Copy className="size-3.5" /></Button>
            <Button type="button" variant="outline" size="icon-sm" onClick={() => void refresh()} aria-label="Refresh PONS state" title="Refresh state"
              className="border-foreground/10 bg-foreground/[0.025] text-muted-foreground hover:bg-foreground/[0.06] hover:text-signal"><RefreshCw className={`size-3.5 ${isRefreshing ? "animate-spin" : ""}`} /></Button>
          </div>
        </div>

        {copyState !== "idle" ? <div role="status" className="fixed right-4 top-20 z-50 rounded border border-foreground/10 bg-[var(--surface-popover)]/95 px-3 py-2 font-medium text-xs tracking-normal text-signal shadow-xl">{copyState === "copied" ? "View link copied" : "Copy unavailable"}</div> : null}
        {experience === "observe" ? <>
        <div className="workspace-search" role="search" aria-label="Search all Robinhood Chain tokens"><TokenSearch onSelect={inspectSearchResult} /><span className="hidden text-sm text-muted-foreground sm:block">Robinhood Chain</span></div>

        {state ? <div data-guide="freshness"><IntegrityRail state={state} onMetric={exploreMetric} /></div> : null}
        <div className="workspace-freshness">
          <p role="status" className="min-w-60 flex-1 text-sm text-attention">{!state ? "Loading chain evidence…" : state.mode !== "live" || state.index.liveLagBlocks > 10_000 ? `Historical trade reading · ${integer.format(state.index.liveLagBlocks)} blocks behind. Readings describe the indexed window.` : `Current evidence · ${integer.format(state.index.liveLagBlocks)} blocks behind the observed head.`}</p>
          <FieldGuide onStart={() => setActiveView("signals")} onExplore={() => setActiveView("atlas")} onWatch={() => setActiveView("watchlist")} onEvidence={() => setActiveView("evidence")} />
        </div>
        {error && state ? <div role="status" className="mb-3 flex items-center justify-between gap-3 rounded border border-danger/20 bg-danger/[0.045] px-3 py-2 font-mono text-xs text-danger/75"><span>{error} · showing the last verified state</span><button type="button" onClick={() => void refresh()} className="uppercase tracking-[0.1em]">Retry</button></div> : null}
        {!state || state.mode === "empty" ? <><FactoryActivity stream={factoryStream} onInspect={event => { setFactoryEvent(event); setSelectedAddress(event.tokenAddress); setDossierOpen(true); }} /><EmptyEngine error={error} onWake={() => void wake()} wakeState={wakeState} /></> : (
          <Tabs value={activeView} onValueChange={(value) => setActiveView(value as ObservatoryView)} className="gap-3">
            <div data-guide="navigation" className="observatory-toolbar">
              <TabsList variant="line" className="workspace-tabs">
                <TabsTrigger value="signals" className="workspace-tab"><BarChart3 />Signals</TabsTrigger>
                <TabsTrigger value="atlas" className="workspace-tab"><Orbit />Atlas</TabsTrigger>
                <TabsTrigger value="watchlist" className="workspace-tab"><BellRing />Watchlist{watchlist.length ? <span className={`ml-0.5 rounded px-1.5 py-0.5 text-xs ${unreadWatchAlerts ? "bg-signal/10 text-signal" : "bg-foreground/[0.055] text-muted-foreground"}`}>{unreadWatchAlerts || watchlist.length}</span> : null}</TabsTrigger>
                <TabsTrigger value="tape" className="workspace-tab"><Activity />Lifecycle</TabsTrigger>
                <TabsTrigger value="history" className="workspace-tab"><History />History</TabsTrigger>
                <TabsTrigger value="evidence" className="workspace-tab"><Database />Evidence</TabsTrigger>
                <TabsTrigger value="premium" className="workspace-tab"><ShieldCheck />Premium</TabsTrigger>
                <TabsTrigger value="network" className="workspace-tab"><Network />Network</TabsTrigger>
              </TabsList>
              <div className="workspace-window">
                <span className="text-xs text-muted-foreground">Research window</span>
                <Select value={String(windowBlocks)} onValueChange={(value) => setWindowBlocks(Number(value))}>
                  <SelectTrigger aria-label="Select research window" size="sm" className="w-[228px] max-w-full text-sm text-muted-foreground"><SelectValue /></SelectTrigger>
                  <SelectContent className="border-foreground/10 bg-[var(--surface-popover)] text-foreground/70">{PONS_STATE_WINDOWS.map((blocks) => <SelectItem key={blocks} value={String(blocks)}>{integer.format(blocks)} blocks · {windowLabel(blocks)}</SelectItem>)}</SelectContent>
                </Select>
              </div>
            </div>
            <TabsContent value="signals">
              <FactoryActivity state={state} stream={factoryStream} onInspect={(event) => { setFactoryEvent(event); setSelectedAddress(event.tokenAddress); setDossierOpen(true); }} />
              <ProtocolPulse state={state} onLeader={inspectLeader} onMetric={explorePulse} />
              <div className="mt-3"><CohortStrip cohorts={state.cohorts} activePair={activePair} onPair={choosePair} /></div>
              <div data-guide="reading"><SignalDesk launches={filteredLaunches} selected={selected} onSelect={inspectLaunch} state={state} isSaved={isSaved} onToggleSave={toggleWatch} phase={phaseFilter} setPhase={setPhaseFilter} signal={signalFilter} setSignal={setSignalFilter} sort={signalSort} setSort={setSignalSort} /></div>
              <details className="workspace-context"><summary><span>Coverage &amp; market context</span><span>Protocols, state memory, and quote-asset relationships</span></summary><div className="space-y-4"><ProtocolCoveragePanel state={state} onBrowse={browseGeneration} /><StateMemoryPanel state={state} /><CohortMatrix cohorts={state.cohorts} onPair={explorePair} /></div></details>
            </TabsContent>
            <TabsContent value="atlas">
              <CohortStrip cohorts={state.cohorts} activePair={activePair} onPair={choosePair} />
              <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_410px] xl:grid-cols-[minmax(0,1fr)_450px]">
                <PonsGravityField pair={activePair} cohort={cohort} launches={filteredLaunches} selected={selected} onSelect={inspectLaunch} />
                <LaunchDossier launch={selected} saved={selected ? isSaved(selected.tokenAddress) : false} onToggleSave={toggleWatch} />
              </div>
              <CohortMatrix cohorts={state.cohorts} onPair={choosePair} />
            </TabsContent>
            <TabsContent value="watchlist"><WatchlistPanel transitions={watchTransitions} transitionError={watchTransitionError} entries={watchlist} launches={state.launches} onInspect={inspectWatched} onRulesChange={updateWatchRules} onRemove={removeWatch} onReadAll={markWatchAlertsRead} storageMode={passport?.authenticated ? "passport" : "device"} syncMessage={watchSyncMessage} /></TabsContent>
            <TabsContent value="tape"><FactoryActivity state={state} stream={factoryStream} onInspect={(event) => { setFactoryEvent(event); setSelectedAddress(event.tokenAddress); setDossierOpen(true); }} expanded /><PonsTape events={state.tape} onInspect={inspectLeader} state={state} /></TabsContent>
            <TabsContent value="history"><ProtocolHistoryPanel state={state} /></TabsContent>
            <TabsContent value="premium"><PremiumResearchWorkspace key={identityVersion} passport={passport} launches={state.launches} initialToken={selectedAddress} onRefreshPassport={refreshPassport} /></TabsContent>
            <TabsContent value="evidence" className="space-y-3">
              <EvidencePanel state={state} onWake={() => void wake()} wakeState={wakeState} />
              <ProtocolCoveragePanel state={state} onBrowse={browseGeneration} />
              <StateMemoryPanel state={state} />
            </TabsContent>
            <TabsContent value="network"><NetworkPanel state={state} passport={passport} localWatchCount={watchlist.length} windowBlocks={windowBlocks} onOpenSignals={() => setActiveView("signals")} onOpenWatchlist={() => setActiveView("watchlist")} onRefreshPassport={refreshPassport} onSyncWatches={syncCurrentWatches} /></TabsContent>
          </Tabs>
        )}
        </> : experience === "research" ? <PremiumResearchWorkspace key={identityVersion} passport={passport} launches={state?.launches ?? []} initialToken={selectedAddress} onRefreshPassport={refreshPassport} /> : <div className="space-y-8">
          <section aria-label="Saved token watches"><WatchlistPanel transitions={watchTransitions} transitionError={watchTransitionError} entries={watchlist} launches={state?.launches ?? []} onInspect={inspectWatched} onRulesChange={updateWatchRules} onRemove={removeWatch} onReadAll={markWatchAlertsRead} storageMode={passport?.authenticated ? "passport" : "device"} syncMessage={watchSyncMessage} /></section>
          <PremiumResearchWorkspace key={identityVersion} passport={passport} launches={state?.launches ?? []} initialToken={selectedAddress} initialTab="saved" onRefreshPassport={refreshPassport} />
        </div>}

        {pulseSelection ? <PulseEvidence key={`${pulseSelection.metric}:${pulseSelection.toBlock}`} selection={pulseSelection} onClose={() => setPulseSelection(null)} onInspect={inspectLeader} /> : null}
        <Dialog open={dossierOpen} onOpenChange={setDossierOpen}><DialogContent className="max-h-[90dvh] overflow-y-auto p-3 sm:max-w-2xl">
          <DialogTitle className="px-3 pt-2">Inspect evidence{selected ? ` · ${selected.symbol === "—" ? selected.name : selected.symbol}` : ""}</DialogTitle>
          <DialogDescription className="px-3">The same dated evidence, from every view.</DialogDescription>
          {selectedAddress ? <TokenOverview key={selectedAddress} address={selectedAddress} indexed={Boolean(selected)} onIdentity={setSelectedIdentity} /> : null}
          {factoryEvent ? <section className="rounded-lg border border-signal/20 p-4 text-sm leading-7"><p className="font-semibold text-signal">{factoryEvent.detail}</p><p>{factoryEvent.tokenSymbol === "—" ? "Token identity is being resolved" : factoryEvent.tokenSymbol} · {quoteAssetLabel(factoryEvent.pairSymbol)} habitat</p><p>Block {integer.format(factoryEvent.blockNumber)} · {new Date(factoryEvent.observedAt).toUTCString()}</p><p className="mt-2 text-muted-foreground">This factory event is confirmed independently. Trade activity, holder retention and present relevance require separate evidence; the event itself earns no attention score.</p><div className="mt-3 flex flex-wrap gap-4"><a className="underline" href={robinhoodExplorer.tx(factoryEvent.txHash)} target="_blank" rel="noreferrer">Inspect transaction <ExternalLink className="inline size-3" aria-hidden="true" /></a><a className="underline" href={robinhoodExplorer.address(factoryEvent.tokenAddress)} target="_blank" rel="noreferrer">{short(factoryEvent.tokenAddress)} <ExternalLink className="inline size-3" aria-hidden="true" /></a><a className="underline" href={`https://www.ponsfamily.com/launchpad/${factoryEvent.tokenAddress}`} target="_blank" rel="noreferrer">Open PONS <ExternalLink className="inline size-3" aria-hidden="true" /></a></div></section> : null}
          {selected ? <LaunchDossier launch={selected} saved={isSaved(selected.tokenAddress)} onToggleSave={toggleWatch} /> : null}
          {selectedAddress ? <a href={appTokenHref("research", selectedAddress)} className="inline-flex items-center justify-center gap-2 rounded border border-foreground/15 px-4 py-3 text-sm hover:bg-foreground/5"><ShieldCheck className="size-4" />Ask about this token · Holder access</a> : null}
        </DialogContent></Dialog>
        <footer className="workspace-footer">
          <a href="/docs" className="text-attention underline underline-offset-4">Documentation</a>
          <span>{state?.index.source ?? "PONS V2 canonical factory"}{state?.index.lastSuccessAt ? ` · collected ${relativeTime(state.index.lastSuccessAt)}` : ""}</span>
          <span>Attention describes observed activity—not asset quality, backing, or financial merit</span>
        </footer>
        </main>
      </div>
    </div>
  );
}
