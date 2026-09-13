"use client";
import { ArrowUpRight, ExternalLink, GitBranch } from "lucide-react";
import type { CSSProperties } from "react";
import type { PonsProtocolGeneration, PonsStateResponse } from "@/lib/pons/model";
import { PONS_V1_CURRENT_FACTORY, PONS_V1_CURRENT_START_BLOCK, PONS_V1_LEGACY_FACTORY, PONS_V1_LEGACY_START_BLOCK } from "@/lib/pons/constants";

const integer = new Intl.NumberFormat("en-US");
const identity = {
  v2: { mark: "V2", title: "Bonding curve", label: "Current generation", tone: "var(--signal)", note: "Launch → curve → locked V4 pool" },
  "v1-current": { mark: "V1", title: "The V1 era", label: "Current factory", tone: "var(--attention)", note: "Uniswap V3 · trading from launch" },
  "v1-legacy": { mark: "V1", title: "The origins", label: "Legacy factory", tone: "var(--culture)", note: "Uniswap V3 · original factory" },
};
function CoverageTrack({ label, value }: { label: string; value: number }) {
  return <div>
    <div className="mb-1.5 flex justify-between gap-3 text-[10px]"><span className="text-muted-foreground">{label}</span><span className="font-mono tabular-nums text-[var(--generation-tone)]">{value.toFixed(1)}%</span></div>
    <div role="progressbar" aria-label={label} aria-valuenow={value} aria-valuemin={0} aria-valuemax={100} className="h-[3px] overflow-hidden rounded-full bg-foreground/[0.08]"><div className="h-full rounded-full bg-[var(--generation-tone)]" style={{ width: `${Math.min(100, Math.max(0, value))}%` }} /></div>
  </div>;
}
export function ProtocolCoveragePanel({ state, onBrowse }: { state: PonsStateResponse; onBrowse: (id: PonsProtocolGeneration["id"]) => void }) {
  const fallback: PonsProtocolGeneration[] = [
    { id: "v2", label: "V2", mechanism: "Bonding curve", factory: state.index.factory, startBlock: state.index.backfillFloor, status: "deep", dataDepth: "Lifecycle evidence", indexedThroughBlock: state.index.latestIndexedBlock, historicalProgress: state.index.historicalProgress, rankingEligible: true },
    { id: "v1-current", label: "V1 current", mechanism: "Uniswap V3", factory: PONS_V1_CURRENT_FACTORY, startBlock: PONS_V1_CURRENT_START_BLOCK, status: "registry", dataDepth: "Registry", indexedThroughBlock: null, historicalProgress: 0, rankingEligible: false },
    { id: "v1-legacy", label: "V1 legacy", mechanism: "Uniswap V3", factory: PONS_V1_LEGACY_FACTORY, startBlock: PONS_V1_LEGACY_START_BLOCK, status: "queued", dataDepth: "Registry", indexedThroughBlock: null, historicalProgress: 0, rankingEligible: false },
  ];
  const coverage = state.protocolCoverage;
  return <section className="coverage-map mt-3 overflow-hidden rounded-[9px] border border-foreground/10 bg-[var(--surface-1)]">
    <div className="flex items-start justify-between gap-5 px-5 py-5 sm:px-6 sm:py-6">
      <div>
        <p className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.23em] text-attention"><GitBranch className="size-3.5" />Protocol coverage</p>
        <h3 className="specimen-serif mt-2 text-2xl leading-tight tracking-[-0.025em] text-foreground sm:text-3xl">Three generations.<br className="sm:hidden" /> One evolving history.</h3>
        <p className="mt-2 max-w-2xl text-xs leading-5 text-muted-foreground">V2 powers the current rankings. Earlier factories are being reconstructed, with coverage shown separately.</p>
      </div>
      <div className="shrink-0 pt-1 text-right"><p className="specimen-serif text-3xl text-signal sm:text-4xl">{coverage?.deeplyIndexedGenerations ?? 1}<span className="ml-1 text-xl text-muted-foreground/60">/ {coverage?.canonicalGenerations ?? 3}</span></p><p className="mt-1 font-mono text-[9px] uppercase tracking-[0.12em] text-muted-foreground">activity decoded</p></div>
    </div>
    <div>{(coverage?.generations ?? fallback).map((generation) => {
      const style = identity[generation.id];
      const v2 = generation.id === "v2";
      const launches = generation.launchesIndexed ?? (v2 ? state.coverage.metadataResolved + state.coverage.metadataPending + state.coverage.metadataFailed : null);
      const trades = v2 ? state.summary.trades : generation.swapsIndexed;
      return <article key={generation.id} className="coverage-generation" style={{ "--generation-tone": style.tone } as CSSProperties}>
        <div className="flex items-start gap-4">
          <span aria-hidden="true" className="coverage-ordinal specimen-serif">{style.mark}</span>
          <div className="min-w-0"><p className="font-mono text-[9px] uppercase tracking-[0.16em] text-[var(--generation-tone)]">{style.mark} · {style.label}</p>
            <h4 className="mt-1"><button type="button" onClick={() => onBrowse(generation.id)} className="group flex items-center gap-2 text-left focus-visible:outline-2 focus-visible:outline-signal"><span className="specimen-serif text-2xl leading-tight text-foreground">{style.title}</span><ArrowUpRight className="size-4 shrink-0 text-[var(--generation-tone)] transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5" /></button></h4>
            <p className="mt-2 text-[11px] text-muted-foreground">{style.note}</p>
            <span className="mt-3 inline-flex items-center gap-1.5 rounded-full border border-[var(--generation-tone)]/25 bg-[var(--generation-tone)]/5 px-2 py-0.5 font-mono text-[9px] uppercase tracking-[0.09em] text-[var(--generation-tone)]"><span className="size-1 rounded-full bg-current" />{v2 ? "Lifecycle evidence" : generation.status === "complete" ? "Reconstructed" : generation.status === "queued" ? "Queued" : "Reconstructing"}</span>
          </div>
        </div>
        <div className="coverage-counts grid grid-cols-2 gap-4">
          <div><p className="font-mono text-2xl font-medium leading-none tracking-[-0.04em] text-foreground sm:text-3xl">{launches == null ? "—" : integer.format(launches)}</p><p className="mt-2 text-[11px] text-muted-foreground">Launches <strong className="font-normal text-[var(--generation-tone)]">indexed</strong></p></div>
          <div><p className="font-mono text-2xl font-medium leading-none tracking-[-0.04em] text-foreground/75 sm:text-3xl">{trades == null ? "—" : integer.format(trades)}</p><p className="mt-2 text-[11px] text-muted-foreground">{v2 ? "Curve trades" : "V3 swaps indexed"}</p>{v2 ? <p className="mt-1 font-mono text-[9px] text-muted-foreground">{integer.format(state.window.blocks)}-block window</p> : null}</div>
        </div>
        <div className="space-y-3">
          <CoverageTrack label="Historical launch coverage" value={generation.launchProgress ?? generation.historicalProgress} />
          <CoverageTrack label="Historical activity coverage" value={generation.swapProgress ?? generation.historicalProgress} />
          <p className="text-[10px] leading-4 text-muted-foreground">{generation.indexedThroughBlock ? `Activity through #${integer.format(generation.indexedThroughBlock)}` : `History begins at #${integer.format(generation.startBlock)}`}<span className="mx-1.5 text-foreground/20">/</span>{generation.rankingEligible ? "In rankings" : "Outside rankings"}</p>
        </div>
        <a href={`https://robinhoodchain.blockscout.com/address/${generation.factory}`} target="_blank" rel="noreferrer" aria-label={`View ${style.mark} ${style.label} contract on block explorer`} className="coverage-contract inline-flex items-center gap-1.5 font-mono text-[9px] text-muted-foreground transition hover:text-[var(--generation-tone)]">{generation.factory.slice(0, 6)}…{generation.factory.slice(-4)}<ExternalLink className="size-3" /></a>
      </article>;
    })}</div>
    <div className="flex flex-wrap items-center justify-between gap-2 border-t border-foreground/10 px-5 py-3 text-[10px] text-muted-foreground sm:px-6"><span><strong className="font-medium text-signal">Ranking scope</strong><span className="mx-2 text-foreground/20">/</span>V2 activity · historical V1 coverage remains separate</span><a href="https://docs.ponsfamily.com/" target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 hover:text-attention">PONS documentation<ExternalLink className="size-2.5" /></a></div>
  </section>;
}
