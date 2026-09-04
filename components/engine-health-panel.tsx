"use client";

import { AlertTriangle, CheckCircle2, Clock3, Database, Gauge, RadioTower } from "lucide-react";
import { useState } from "react";

import type { EngineHealth } from "@/lib/affinity-model";

function duration(value?: number | null) {
  if (value === null || value === undefined) return "–";
  return value < 1_000 ? `${value} ms` : `${(value / 1_000).toFixed(1)} s`;
}

function age(value?: number | null) {
  if (value === null || value === undefined) return "–";
  if (value < 60_000) return `${Math.max(0, Math.round(value / 1_000))}s`;
  if (value < 3_600_000) return `${Math.round(value / 60_000)}m`;
  return `${Math.round(value / 3_600_000)}h`;
}

function tone(status: string) {
  return status === "healthy" || status === "ok" || status === "succeeded"
    ? "text-signal"
    : status === "critical" || status === "failed"
      ? "text-danger"
      : "text-culture";
}

export function EngineHealthPanel({ engine }: { engine?: EngineHealth | null }) {
  const [wakeState, setWakeState] = useState<"idle" | "sending" | "accepted" | "failed">("idle");
  const wake = async () => {
    setWakeState("sending");
    try {
      const response = await fetch("/api/collector/wake", { method: "POST", headers: { accept: "application/json" } });
      if (!response.ok) throw new Error("wake rejected");
      setWakeState("accepted");
    } catch {
      setWakeState("failed");
    }
  };
  if (!engine) {
    return (
      <section className="mt-3 rounded-[10px] border border-foreground/10 bg-[var(--surface-2)]/72 p-4">
        <p className="font-mono text-[9px] uppercase tracking-[0.2em] text-culture">Engine telemetry initializing</p>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="mt-2 text-xs leading-5 text-foreground/40">The collector has not committed its first observable run yet. Opening the snapshot endpoint also activates the watchdog.</p>
          <button type="button" onClick={wake} disabled={wakeState === "sending"}
            className="rounded border border-signal/25 bg-signal/8 px-3 py-2 font-mono text-[8px] uppercase tracking-[0.14em] text-signal disabled:opacity-40">
            {wakeState === "sending" ? "Dispatching" : wakeState === "accepted" ? "Collection dispatched" : wakeState === "failed" ? "Retry collector" : "Run collector now"}
          </button>
        </div>
      </section>
    );
  }

  const run = engine.collection.latestRun;
  return (
    <section className="mt-3 overflow-hidden rounded-[10px] border border-foreground/10 bg-[var(--surface-2)]/78">
      <div className="grid gap-px bg-foreground/[0.07] sm:grid-cols-2 xl:grid-cols-5">
        <div className="bg-[var(--surface-3)] p-4 sm:col-span-2 xl:col-span-1">
          <div className="flex items-center gap-2"><Gauge className="size-3.5 text-signal" /><p className="engine-label">Engine integrity</p></div>
          <div className="mt-2 flex items-baseline gap-2">
            <span className={`text-3xl font-semibold ${tone(engine.status)}`}>{engine.score}</span>
            <span className="font-mono text-[9px] uppercase tracking-[0.15em] text-foreground/25">/ 100 · {engine.status}</span>
          </div>
        </div>
        <div className="bg-[var(--surface-3)] p-4">
          <div className="flex items-center gap-2"><Clock3 className="size-3.5 text-attention" /><p className="engine-label">Latest run</p></div>
          <p className={`mt-2 font-mono text-[10px] uppercase tracking-[0.1em] ${tone(run?.status ?? "pending")}`}>{run?.status ?? "pending"} · {run?.phase ?? "awaiting genesis"}</p>
          <p className="mt-1 font-mono text-[8px] uppercase tracking-[0.12em] text-foreground/25">{run ? `${run.trigger} · ${duration(run.durationMs)}` : "watchdog armed"}</p>
          <button type="button" onClick={wake} disabled={wakeState === "sending"}
            className="mt-2 font-mono text-[7px] uppercase tracking-[0.12em] text-signal/65 hover:text-signal disabled:opacity-30">
            {wakeState === "sending" ? "dispatching…" : wakeState === "accepted" ? "forced run accepted" : "force new run"}
          </button>
        </div>
        <div className="bg-[var(--surface-3)] p-4">
          <div className="flex items-center gap-2"><Database className="size-3.5 text-attention" /><p className="engine-label">Durable evidence</p></div>
          <p className="mt-2 font-mono text-[10px] uppercase tracking-[0.1em] text-foreground/70">{engine.archive.snapshots} snapshots · {engine.archive.speciesObservations} observations</p>
          <p className="mt-1 font-mono text-[8px] uppercase tracking-[0.12em] text-foreground/25">{engine.archive.chainBlocks} material chain blocks</p>
        </div>
        <div className="bg-[var(--surface-3)] p-4">
          <div className="flex items-center gap-2"><RadioTower className="size-3.5 text-culture" /><p className="engine-label">Robinhood surface</p></div>
          <p className="mt-2 font-mono text-[10px] uppercase tracking-[0.1em] text-foreground/70">{engine.registry.assets} assets · {engine.registry.quotedHabitats} quoted</p>
          <p className="mt-1 font-mono text-[8px] uppercase tracking-[0.12em] text-foreground/25">registry + prices + RPC evidence</p>
        </div>
        <div className="bg-[var(--surface-3)] p-4">
          <div className="flex items-center gap-2">{engine.alerts.length ? <AlertTriangle className="size-3.5 text-danger" /> : <CheckCircle2 className="size-3.5 text-signal" />}<p className="engine-label">Open alerts</p></div>
          <p className={`mt-2 font-mono text-[10px] uppercase tracking-[0.1em] ${engine.alerts.length ? "text-danger" : "text-signal"}`}>{engine.alerts.length ? `${engine.alerts.length} require attention` : "No unresolved anomalies"}</p>
          <p className="mt-1 truncate font-mono text-[8px] uppercase tracking-[0.12em] text-foreground/25">{engine.alerts[0]?.code ?? "evidence lanes nominal"}</p>
        </div>
      </div>

      {engine.sources.length ? (
        <div className="border-t border-foreground/10 px-4 py-3">
          <div className="flex gap-2 overflow-x-auto [scrollbar-width:none]">
            {engine.sources.map((item) => (
              <div key={item.source} className="min-w-[170px] flex-1 rounded border border-foreground/[0.07] bg-foreground/[0.025] px-3 py-2">
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate font-mono text-[8px] uppercase tracking-[0.12em] text-foreground/55">{item.source}</span>
                  <span className={`size-1.5 shrink-0 rounded-full bg-current ${tone(item.status)}`} />
                </div>
                <p className="mt-1.5 font-mono text-[8px] uppercase tracking-[0.1em] text-foreground/25">{duration(item.latencyMs)} · {item.recordCount} records · age {age(item.freshnessMs)}</p>
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </section>
  );
}
