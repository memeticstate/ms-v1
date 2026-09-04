"use client";

import { useEffect, useMemo, useState } from "react";
import { Activity, Database, Gauge, GitBranch, ShieldCheck } from "lucide-react";

import type { Habitat, Species } from "@/lib/affinity-model";

const compactUsd = new Intl.NumberFormat("en-US", {
  style: "currency", currency: "USD", notation: "compact", maximumFractionDigits: 2,
});

type HistoryPoint = {
  observedAt: string;
  marketCapUsd: number;
  volume24hUsd: number;
  liquidityUsd: number;
  marketVitality: number;
};

function Metric({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div className="border-t border-foreground/10 pt-3">
      <p className="font-mono text-[8px] uppercase tracking-[0.17em] text-foreground/32">{label}</p>
      <p className="mt-1 text-lg font-semibold tracking-tight text-foreground/90">{value}</p>
      {note ? <p className="mt-0.5 truncate text-[9px] text-foreground/25">{note}</p> : null}
    </div>
  );
}

function Trait({ label, value, color, detail }: { label: string; value: number; color: string; detail: string }) {
  return (
    <div title={detail}>
      <div className="mb-1.5 flex items-center justify-between gap-3 font-mono text-[8px] uppercase tracking-[0.15em] text-foreground/42">
        <span>{label}</span><span>{value}/100</span>
      </div>
      <div className="h-1 overflow-hidden rounded-full bg-foreground/8">
        <div className="h-full rounded-full transition-[width] duration-500" style={{ width: `${value}%`, backgroundColor: color }} />
      </div>
      <p className="mt-1.5 text-[9px] leading-4 text-foreground/25">{detail}</p>
    </div>
  );
}

function Sparkline({ points, field, color }: {
  points: HistoryPoint[];
  field: "marketCapUsd" | "volume24hUsd";
  color: string;
}) {
  const values = points.map((point) => point[field]);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = Math.max(1, max - min);
  const width = 300;
  const height = 54;
  const coordinates = values.map((value, index) => {
    const x = values.length <= 1 ? width : index / (values.length - 1) * width;
    const y = height - ((value - min) / span) * (height - 8) - 4;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(" ");

  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="h-14 w-full" aria-hidden="true">
      <line x1="0" x2={width} y1={height - 4} y2={height - 4} stroke="white" strokeOpacity="0.08" />
      {values.length > 1 ? (
        <polyline points={coordinates} fill="none" stroke={color} strokeWidth="2" vectorEffect="non-scaling-stroke" />
      ) : (
        <circle cx={width / 2} cy={height / 2} r="3" fill={color} />
      )}
    </svg>
  );
}

export function SpeciesDossier({
  species, habitats, sourceState,
}: { species: Species; habitats: Habitat[]; sourceState: "contract verified" | "reference data" }) {
  const [historyState, setHistoryState] = useState<{ speciesId: string; points: HistoryPoint[] }>({ speciesId: "", points: [] });
  const history = historyState.speciesId === species.id ? historyState.points : [];
  const habitatBySymbol = useMemo(() => new Map(habitats.map((habitat) => [habitat.symbol, habitat])), [habitats]);
  const changeLabel = `${species.change24h >= 0 ? "+" : ""}${species.change24h.toFixed(2)}%`;
  const metrics = species.metrics ?? {
    version: "reference" as const,
    affinityBalance: species.coherence,
    marketVitality: species.vitality,
    marketStress: species.stress,
    turnover24h: species.marketCapUsd > 0 ? species.observedVolumeUsd / species.marketCapUsd * 100 : 0,
    depthRatio: species.marketCapUsd > 0 ? (species.totalDepthUsd ?? 0) / species.marketCapUsd * 100 : 0,
    dataCompleteness: 50,
  };

  useEffect(() => {
    let active = true;
    const load = async () => {
      try {
        const response = await fetch(`/api/species-history?speciesId=${encodeURIComponent(species.id)}&limit=72`);
        if (!response.ok) return;
        const payload = await response.json() as { history?: HistoryPoint[] };
        if (active) setHistoryState({ speciesId: species.id, points: payload.history ?? [] });
      } catch {
        if (active) setHistoryState({ speciesId: species.id, points: [] });
      }
    };
    void load();
    return () => { active = false; };
  }, [species.id]);

  const trajectory = history.length ? history : [{
    observedAt: new Date().toISOString(),
    marketCapUsd: species.marketCapUsd,
    volume24hUsd: species.observedVolumeUsd,
    liquidityUsd: species.liquidityUsd ?? 0,
    marketVitality: metrics.marketVitality,
  }];

  return (
    <aside className="flex h-full flex-col rounded-[10px] border border-foreground/10 bg-[var(--surface-3)]/94 p-5 shadow-2xl shadow-black/20 lg:min-h-[760px] lg:p-6">
      <div className="flex items-start justify-between gap-4">
        <div className="flex min-w-0 items-center gap-3">
          <div className="grid size-12 shrink-0 place-items-center rounded-full border bg-[var(--surface-3)] font-mono text-[10px] font-bold"
            style={{ borderColor: species.color, color: species.color }}>
            {species.symbol.slice(0, 5)}
          </div>
          <div className="min-w-0">
            <p className="font-mono text-[8px] uppercase tracking-[0.2em] text-foreground/35">Species dossier · rank {species.rank ?? "—"}</p>
            <h2 className="mt-1 truncate text-xl font-semibold tracking-tight">{species.name}</h2>
          </div>
        </div>
        <span className="shrink-0 rounded border border-signal/25 bg-signal/8 px-2 py-1 font-mono text-[8px] uppercase tracking-[0.13em] text-signal">
          {species.graduated ? "Graduated" : "Emerging"}
        </span>
      </div>

      <blockquote className="specimen-serif mt-6 border-l pl-4 text-lg leading-snug text-foreground"
        style={{ borderColor: species.color }}>
        {species.thesis}
      </blockquote>
      <p className="mt-3 text-xs leading-5 text-foreground/46">{species.interpretation}</p>

      <div className="mt-6 grid grid-cols-3 gap-x-4 gap-y-4">
        <Metric label="Market cap" value={compactUsd.format(species.marketCapUsd)} />
        <Metric label="24h volume" value={compactUsd.format(species.observedVolumeUsd)} />
        <Metric label="24h change" value={changeLabel} />
        <Metric label="Market depth" value={compactUsd.format(species.totalDepthUsd ?? 0)} note={`${metrics.depthRatio.toFixed(1)}% of cap`} />
        <Metric label="Trades" value={(species.trades24h ?? 0).toLocaleString()} note="rolling 24h" />
        <Metric label="Turnover" value={`${metrics.turnover24h.toFixed(1)}%`} note="volume / cap" />
      </div>

      <div className="mt-6 rounded-md border border-foreground/10 bg-black/10 p-4">
        <div className="mb-4 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <Gauge aria-hidden="true" className="size-3.5 text-signal" />
            <p className="font-mono text-[8px] uppercase tracking-[0.17em] text-foreground/40">Observed metric model</p>
          </div>
          <span className="font-mono text-[8px] uppercase tracking-[0.14em] text-foreground/25">{metrics.version}</span>
        </div>
        <div className="space-y-4">
          <Trait label="Affinity balance" value={metrics.affinityBalance} color="var(--signal)" detail="Normalized entropy of declared habitat weights." />
          <Trait label="Market vitality" value={metrics.marketVitality} color={species.color} detail="Turnover, trade frequency and available depth." />
          <Trait label="Market stress" value={metrics.marketStress} color="var(--danger)" detail="24h volatility plus depth fragility." />
        </div>
        <div className="mt-4 flex items-center justify-between border-t border-foreground/8 pt-3 font-mono text-[8px] uppercase tracking-[0.13em] text-foreground/25">
          <span>Data completeness</span><span>{metrics.dataCompleteness}/100</span>
        </div>
      </div>

      <div className="mt-6 rounded-md border border-foreground/10 bg-[var(--surface-3)] p-4">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <Activity aria-hidden="true" className="size-3.5 text-attention" />
            <div>
              <p className="font-mono text-[8px] uppercase tracking-[0.17em] text-foreground/40">Observed trajectory</p>
              <p className="mt-0.5 text-[9px] text-foreground/24">{history.length || 1} frozen state{(history.length || 1) === 1 ? "" : "s"}</p>
            </div>
          </div>
          <Database aria-hidden="true" className="size-3 text-foreground/20" />
        </div>
        <div className="mt-3 grid grid-cols-2 gap-4">
          <div>
            <div className="flex items-center justify-between font-mono text-[8px] uppercase tracking-[0.12em] text-foreground/25">
              <span>Market cap</span><span>{compactUsd.format(species.marketCapUsd)}</span>
            </div>
            <Sparkline points={trajectory} field="marketCapUsd" color={species.color} />
          </div>
          <div>
            <div className="flex items-center justify-between font-mono text-[8px] uppercase tracking-[0.12em] text-foreground/25">
              <span>Volume</span><span>{compactUsd.format(species.observedVolumeUsd)}</span>
            </div>
            <Sparkline points={trajectory} field="volume24hUsd" color="var(--attention)" />
          </div>
        </div>
      </div>

      <div className="mt-6">
        <div className="flex items-end justify-between gap-3">
          <div className="flex items-center gap-2">
            <GitBranch aria-hidden="true" className="size-3.5 text-culture" />
            <div>
              <p className="font-mono text-[8px] uppercase tracking-[0.18em] text-foreground/35">Declared affinity genome</p>
              <p className="mt-0.5 text-[9px] text-foreground/25">Registry-linked PAIR composition</p>
            </div>
          </div>
          <p className="text-right font-mono text-[8px] uppercase tracking-[0.12em] text-foreground/24">Not asset backing</p>
        </div>
        <div className="mt-4 space-y-3">
          {species.genome.map((gene) => {
            const habitat = habitatBySymbol.get(gene.habitat);
            const multiplier = Number(habitat?.currentMultiplier ?? "1");
            return (
              <div key={gene.habitat} className="grid grid-cols-[48px_1fr_44px] items-center gap-3">
                <div>
                  <span className="font-mono text-[10px] font-semibold" style={{ color: habitat?.color }}>
                    {gene.habitat}
                  </span>
                  {Number.isFinite(multiplier) && multiplier !== 1 ? (
                    <p className="font-mono text-[7px] text-foreground/20">×{multiplier.toFixed(3)}</p>
                  ) : null}
                </div>
                <div className="h-1.5 overflow-hidden rounded-full bg-foreground/8">
                  <div className="h-full rounded-full" style={{ width: `${gene.weight}%`, backgroundColor: habitat?.color ?? species.color }} />
                </div>
                <span className="text-right font-mono text-[9px] text-foreground/40">{gene.weight}%</span>
              </div>
            );
          })}
        </div>
      </div>

      <div className="mt-6 border-t border-foreground/10 pt-4">
        <div className="flex items-center justify-between gap-3 font-mono text-[8px] uppercase tracking-[0.12em] text-foreground/30">
          <div className="flex min-w-0 items-center gap-2">
            <ShieldCheck aria-hidden="true" className="size-3 shrink-0 text-signal" />
            <a
              href={`https://robinhoodchain.blockscout.com/address/${species.contract}`}
              target="_blank"
              rel="noreferrer"
              className="truncate underline decoration-white/15 underline-offset-4 hover:text-foreground/55"
            >
              {species.contract}
            </a>
          </div>
          <span className="shrink-0">{sourceState}</span>
        </div>
        <div className="mt-2 flex items-center justify-between gap-3 text-[9px] text-foreground/24">
          <span>{species.marketDataSource ?? species.sourceLabel}</span>
          <span>{species.launchedAt ? `Launched ${new Date(species.launchedAt).toLocaleDateString("en-GB")}` : species.sourceLabel}</span>
        </div>
      </div>
    </aside>
  );
}
