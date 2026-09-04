"use client";

import { useEffect, useState } from "react";
import { Activity, Braces, Clock3, GitCommitHorizontal, ShieldCheck } from "lucide-react";

import type { AffinitySnapshot, ChainBlock } from "@/lib/affinity-model";

type BlockRecord = {
  chainBlockId: string;
  number: number;
  detectedAt: string;
  snapshotId: string;
  previousSnapshotId: string | null;
  kind: string;
  significance: number;
  block: ChainBlock;
};

const kindTone: Record<string, string> = {
  genesis: "var(--slate)",
  topology: "var(--signal)",
  affinity: "var(--attention)",
  market: "var(--culture)",
};

export function ChainBlockView({ snapshot }: { snapshot: AffinitySnapshot }) {
  const [history, setHistory] = useState<BlockRecord[]>([]);
  const featured = snapshot.species.filter((species) => snapshot.block.speciesIds.includes(species.id));
  const engineLabel = snapshot.block.engineVersion === "deterministic-evidence-v2"
    ? "Deterministic evidence engine · v2"
    : snapshot.block.engineVersion === "deterministic-delta-v2"
      ? "Deterministic state diff · v2"
    : snapshot.block.engineVersion === "deterministic-delta-v1"
      ? "Deterministic delta · v1"
      : "Authored baseline · v0.1";

  useEffect(() => {
    let active = true;
    const load = async () => {
      try {
        const response = await fetch("/api/chain-blocks?limit=8");
        if (!response.ok) return;
        const payload = await response.json() as { blocks?: BlockRecord[] };
        if (active) setHistory(payload.blocks ?? []);
      } catch {
        if (active) setHistory([]);
      }
    };
    void load();
    return () => { active = false; };
  }, [snapshot.block.number]);

  return (
    <div className="space-y-3">
      <section className="relative min-h-[660px] overflow-hidden rounded-[10px] border border-foreground/10 bg-[var(--surface-popover)]">
        <div className="absolute -right-20 -top-24 size-[420px] rounded-full border border-danger/15 bg-danger/5 blur-sm" />
        <div className="absolute -bottom-48 left-[20%] size-[520px] rounded-full border border-signal/15 bg-signal/5 blur-sm" />

        <div className="relative grid min-h-[660px] lg:grid-cols-[0.58fr_1.42fr]">
          <div className="flex flex-col justify-between border-b border-foreground/10 p-6 lg:border-b-0 lg:border-r lg:p-9">
            <div>
              <div className="flex items-center justify-between gap-3">
                <p className="font-mono text-[9px] uppercase tracking-[0.24em] text-danger">Chain Block</p>
                <span className="rounded-full border border-foreground/10 px-2.5 py-1 font-mono text-[8px] uppercase tracking-[0.13em] text-foreground/30">
                  {snapshot.block.kind ?? "baseline"}
                </span>
              </div>
              <p className="specimen-serif mt-4 text-[112px] leading-none tracking-[-0.08em] text-foreground/95 lg:text-[146px]">
                {snapshot.block.number}
              </p>
              <p className="mt-2 font-mono text-[9px] uppercase tracking-[0.18em] text-foreground/35">{snapshot.block.date}</p>

              <div className="mt-8 grid grid-cols-2 gap-px overflow-hidden rounded-md border border-foreground/10 bg-foreground/10">
                <div className="bg-[var(--surface-popover)] p-3">
                  <p className="font-mono text-[8px] uppercase tracking-[0.14em] text-foreground/25">Confidence</p>
                  <p className="mt-1 text-xl font-semibold text-foreground/85">{snapshot.block.confidence ?? "—"}{snapshot.block.confidence !== undefined ? "%" : ""}</p>
                </div>
                <div className="bg-[var(--surface-popover)] p-3">
                  <p className="font-mono text-[8px] uppercase tracking-[0.14em] text-foreground/25">Materiality</p>
                  <p className="mt-1 text-xl font-semibold text-foreground/85">{snapshot.block.significance ?? "—"}{snapshot.block.significance !== undefined ? "/100" : ""}</p>
                </div>
              </div>
            </div>

            <div className="mt-10 space-y-5">
              <div>
                <p className="font-mono text-[8px] uppercase tracking-[0.18em] text-foreground/28">Constituent species</p>
                <div className="mt-3 flex flex-wrap gap-2">
                  {featured.length ? featured.map((species) => (
                    <span key={species.id} className="rounded-full border bg-black/10 px-3 py-1.5 font-mono text-[9px]"
                      style={{ borderColor: `${species.color}66`, color: species.color }}>
                      {species.symbol}
                    </span>
                  )) : <span className="font-mono text-[9px] uppercase tracking-[0.12em] text-foreground/25">Historical cohort</span>}
                </div>
              </div>
              <div className="space-y-2 border-t border-foreground/10 pt-4 font-mono text-[8px] uppercase tracking-[0.12em] text-foreground/28">
                <div className="flex items-center justify-between gap-3"><Clock3 className="size-3" /><span>{snapshot.block.window ?? "Baseline window"}</span></div>
                <div className="flex items-center justify-between gap-3"><GitCommitHorizontal className="size-3" /><span>Frozen snapshot lineage</span></div>
                <div className="flex items-center justify-between gap-3"><ShieldCheck className="size-3 text-signal" /><span>Reconciled contracts</span></div>
              </div>
            </div>
          </div>

          <div className="flex flex-col p-6 lg:p-10 xl:p-12">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="font-mono text-[8px] uppercase tracking-[0.2em] text-signal">Primary material state change</p>
              <span className="font-mono text-[8px] uppercase tracking-[0.14em] text-foreground/25">{engineLabel}</span>
            </div>
            <h2 className="specimen-serif mt-5 max-w-3xl text-5xl leading-[0.95] tracking-[-0.04em] text-foreground md:text-7xl">
              {snapshot.block.title}
            </h2>
            <p className="mt-6 max-w-3xl text-lg leading-8 text-foreground/72">{snapshot.block.signal}</p>
            <p className="mt-5 max-w-3xl text-sm leading-7 text-foreground/43">{snapshot.block.interpretation}</p>

            <div className="mt-8 grid grid-cols-2 gap-px overflow-hidden rounded-md border border-foreground/10 bg-foreground/10 lg:grid-cols-4">
              {snapshot.block.evidence.map((item) => (
                <div key={item.label} className="bg-[var(--surface-popover)] p-4">
                  <p className="font-mono text-[8px] uppercase tracking-[0.14em] text-foreground/28">{item.label}</p>
                  <p className="mt-2 text-xl font-semibold tracking-tight text-foreground/85">{item.value}</p>
                </div>
              ))}
            </div>

            <div className="mt-8">
              <div className="mb-3 flex items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  <Activity aria-hidden="true" className="size-3.5 text-signal" />
                  <p className="font-mono text-[8px] uppercase tracking-[0.17em] text-foreground/38">Material drivers</p>
                </div>
                <span className="font-mono text-[8px] uppercase tracking-[0.12em] text-foreground/22">All threshold crossings retained</span>
              </div>
              {snapshot.block.drivers?.length ? (
                <div className="grid gap-2 md:grid-cols-3">
                  {snapshot.block.drivers.map((driver) => (
                    <div key={`${driver.kind}-${driver.label}`} className="rounded-md border border-foreground/10 bg-black/10 p-3">
                      <div className="flex items-center justify-between gap-3">
                        <p className="font-mono text-[8px] uppercase tracking-[0.13em]" style={{ color: kindTone[driver.kind] ?? "var(--slate)" }}>
                          {driver.label}
                        </p>
                        <span className="font-mono text-[8px] text-foreground/28">{driver.significance}/100</span>
                      </div>
                      <p className="mt-2 text-[11px] leading-5 text-foreground/43">{driver.summary}</p>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="rounded-md border border-dashed border-foreground/10 px-4 py-5 text-xs leading-5 text-foreground/30">
                  This is the authored baseline. The next material verified difference will begin the multi-driver ledger.
                </div>
              )}
            </div>

            <div className="mt-auto flex items-center justify-between border-t border-foreground/10 pt-4 font-mono text-[8px] uppercase tracking-[0.13em] text-foreground/26">
              <span className="flex items-center gap-2"><Braces className="size-3" /> Machine-readable evidence</span>
              <span>Graph diff + provenance</span>
            </div>
          </div>
        </div>
      </section>

      <section className="overflow-hidden rounded-[10px] border border-foreground/10 bg-[var(--surface-2)]">
        <div className="flex items-center justify-between gap-3 border-b border-foreground/10 px-4 py-3">
          <div>
            <p className="font-mono text-[8px] uppercase tracking-[0.18em] text-attention">State memory</p>
            <p className="mt-1 text-xs text-foreground/36">Material blocks retained independently from routine snapshots</p>
          </div>
          <span className="font-mono text-[8px] uppercase tracking-[0.13em] text-foreground/25">{history.length} derived blocks</span>
        </div>
        {history.length ? (
          <div className="grid divide-y divide-white/8 lg:grid-cols-4 lg:divide-x lg:divide-y-0">
            {history.slice(0, 4).map((record) => (
              <article key={record.chainBlockId} className="p-4">
                <div className="flex items-center justify-between gap-3">
                  <span className="font-mono text-[8px] uppercase tracking-[0.14em]" style={{ color: kindTone[record.kind] ?? "var(--slate)" }}>
                    Block {record.number} · {record.kind}
                  </span>
                  <span className="font-mono text-[8px] text-foreground/25">{record.significance}</span>
                </div>
                <h3 className="mt-3 text-sm font-semibold tracking-tight text-foreground/75">{record.block.title}</h3>
                <p className="mt-2 line-clamp-2 text-[10px] leading-4 text-foreground/30">{record.block.signal}</p>
                <p className="mt-3 font-mono text-[8px] uppercase tracking-[0.11em] text-foreground/20">
                  {new Date(record.detectedAt).toLocaleString("en-GB", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}
                </p>
              </article>
            ))}
          </div>
        ) : (
          <div className="px-4 py-6 text-xs text-foreground/30">The first v2 material difference will appear here automatically.</div>
        )}
      </section>
    </div>
  );
}
