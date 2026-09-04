"use client";

import { useEffect, useMemo, useState } from "react";
import { Activity, Box, Database, Network, Radar, ShieldCheck } from "lucide-react";

import { AffinityField } from "@/components/affinity-field";
import { ChainBlockView } from "@/components/chain-block-view";
import { EngineHealthPanel } from "@/components/engine-health-panel";
import { SpeciesDossier } from "@/components/species-dossier";
import { SpeciesNavigator } from "@/components/species-navigator";
import { StateGlyph } from "@/components/state-glyph";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { affinitySnapshot } from "@/data/affinity-snapshot";
import type { AffinityHealth, AffinitySnapshot, SnapshotEnvelope, SnapshotMode } from "@/lib/affinity-model";

const referenceMeta: SnapshotEnvelope["meta"] = {
  mode: "reference",
  generatedAt: affinitySnapshot.observedAt,
  sourceObservedAt: affinitySnapshot.observedAt,
  sources: [],
  warnings: [],
};

function ageLabel(mode: SnapshotMode, observedAt?: string) {
  if (mode === "reference") return "Reference snapshot";
  if (!observedAt) return mode;
  const seconds = Math.max(0, Math.floor((Date.now() - new Date(observedAt).getTime()) / 1000));
  const age = seconds < 60 ? `${seconds}s` : `${Math.floor(seconds / 60)}m`;
  return `${mode} · ${age}`;
}

function ObservationRail({ snapshot, meta, health }: {
  snapshot: AffinitySnapshot;
  meta: SnapshotEnvelope["meta"];
  health: AffinityHealth | null;
}) {
  const collection = health?.collection;
  const quorum = meta.reconciliation;
  const collectorTone = collection?.status === "healthy"
    ? "text-signal"
    : collection?.status === "degraded"
      ? "text-danger"
      : "text-culture";

  return (
    <section aria-label="Observation integrity" className="observation-rail mb-4 grid grid-cols-2 overflow-hidden rounded-[8px] border border-foreground/10 bg-[var(--surface-2)]/76 md:grid-cols-3 xl:grid-cols-6">
      <div className="observation-cell">
        <Radar aria-hidden="true" className="size-3.5 text-attention" />
        <div><p className="observation-label">Discovery</p><p className="observation-value">{snapshot.coverage ? `${snapshot.coverage.discoveredSpecies.toLocaleString()} species` : `${snapshot.species.length} reference`}</p></div>
      </div>
      <div className="observation-cell">
        <ShieldCheck aria-hidden="true" className="size-3.5 text-signal" />
        <div><p className="observation-label">Verified cohort</p><p className="observation-value">{snapshot.coverage ? `${snapshot.coverage.verifiedSpecies}/${snapshot.coverage.observedSpecies} deep states` : "Reference cohort"}</p></div>
      </div>
      <div className="observation-cell">
        <Database aria-hidden="true" className="size-3.5 text-signal" />
        <div><p className="observation-label">Archive</p><p className="observation-value">{meta.ledger ? `${meta.ledger.position} states` : "Awaiting genesis"}</p></div>
      </div>
      <div className="observation-cell">
        <span className={`size-1.5 rounded-full bg-current ${collectorTone}`} />
        <div><p className="observation-label">Collector</p><p className={`observation-value ${collectorTone}`}>{collection?.status ?? "pending"} · {collection?.cadenceMinutes ?? 5}m</p></div>
      </div>
      <div className="observation-cell">
        <Network aria-hidden="true" className="size-3.5 text-attention" />
        <div><p className="observation-label">RPC consensus</p><p className="observation-value">{quorum ? `${quorum.quorum}/${quorum.providerCount} providers` : "Not reconciled"}</p></div>
      </div>
      <div className="observation-cell">
        <Box aria-hidden="true" className="size-3.5 text-culture" />
        <div><p className="observation-label">Observed head</p><p className="observation-value">{quorum ? `#${quorum.blockNumber.toLocaleString()}` : `${snapshot.chain} · reference`}</p></div>
      </div>
    </section>
  );
}

export function MemeticStateApp() {
  const [selectedId, setSelectedId] = useState("chips");
  const [activeHabitat, setActiveHabitat] = useState<string | null>(null);
  const [snapshot, setSnapshot] = useState<AffinitySnapshot>(affinitySnapshot);
  const [meta, setMeta] = useState<SnapshotEnvelope["meta"]>(referenceMeta);
  const [health, setHealth] = useState<AffinityHealth | null>(null);
  const [, setClock] = useState(0);

  useEffect(() => {
    let active = true;
    const refresh = async () => {
      try {
        const [response, healthResponse] = await Promise.all([
          fetch("/api/affinity-snapshot", { headers: { accept: "application/json" } }),
          fetch("/api/affinity-health", { headers: { accept: "application/json" } }).catch(() => null),
        ]);
        if (!response.ok) throw new Error("snapshot request failed");
        const envelope = await response.json() as SnapshotEnvelope;
        if (active) {
          setSnapshot(envelope.snapshot);
          setMeta(envelope.meta);
          setSelectedId((current) => envelope.snapshot.species.some((species) => species.id === current)
            ? current
            : envelope.snapshot.species[0]?.id ?? current);
          if (healthResponse?.ok) setHealth(await healthResponse.json() as AffinityHealth);
        }
      } catch {
        if (active) setMeta((current) => ({ ...current, mode: current.mode === "live" ? "cached" : current.mode }));
      }
    };
    void refresh();
    const refreshTimer = window.setInterval(refresh, 60_000);
    const clockTimer = window.setInterval(() => setClock((value) => value + 1), 15_000);
    return () => {
      active = false;
      window.clearInterval(refreshTimer);
      window.clearInterval(clockTimer);
    };
  }, []);

  const selected = useMemo(
    () => snapshot.species.find((species) => species.id === selectedId) ?? snapshot.species[0],
    [selectedId, snapshot],
  );
  const freshnessLabel = ageLabel(meta.mode, meta.sourceObservedAt);

  return (
    <main className="min-h-screen px-3 py-3 sm:px-5 sm:py-5 lg:px-7">
      <div className="mx-auto max-w-[1680px]">
        <header className="mb-4 flex flex-wrap items-center justify-between gap-3 border-b border-foreground/10 px-1 pb-4">
          <div className="flex items-center gap-3">
            <div className="state-glyph-shell grid size-11 place-items-center text-signal">
              <StateGlyph className="size-10" />
            </div>
            <div>
              <h1 className="text-sm font-semibold uppercase tracking-[0.18em]">
                Memetic <span className="specimen-serif text-base font-normal italic normal-case tracking-normal text-signal">State</span>
              </h1>
              <p className="mt-0.5 font-mono text-[9px] uppercase tracking-[0.15em] text-foreground/30">
                Cultural atlas for tokenized markets
              </p>
            </div>
          </div>

          <div className="flex items-center gap-4">
            <div className="hidden items-center gap-2 sm:flex">
              <Network className="size-3.5 text-foreground/30" aria-hidden="true" />
              <p className="font-mono text-[9px] uppercase tracking-[0.15em] text-foreground/35">
                {snapshot.coverage?.discoveredSpecies.toLocaleString() ?? snapshot.species.length} discovered · {snapshot.species.length} observed · {snapshot.edges.length} validated edges
              </p>
            </div>
            <div className="rounded border border-foreground/10 bg-foreground/5 px-3 py-2 font-mono text-[9px] uppercase tracking-[0.14em] text-foreground/45">
              {snapshot.chain} · {meta.reconciliation ? `#${meta.reconciliation.blockNumber.toLocaleString()}` : `Block ${snapshot.block.number}`}
            </div>
          </div>
        </header>

        <ObservationRail snapshot={snapshot} meta={meta} health={health} />

        <Tabs defaultValue="biosphere" className="gap-4">
          <div className="flex flex-wrap items-center justify-between gap-3 px-1">
            <TabsList variant="line" className="h-10 gap-5 p-0">
              <TabsTrigger value="biosphere" className="px-0 font-mono text-[10px] uppercase tracking-[0.15em]">
                <Activity aria-hidden="true" /> Biosphere
              </TabsTrigger>
              <TabsTrigger value="block" className="px-0 font-mono text-[10px] uppercase tracking-[0.15em]">
                <StateGlyph className="size-4" /> Chain block
              </TabsTrigger>
            </TabsList>
            <p className="max-w-xl text-right text-xs leading-5 text-foreground/35">
              Stocks are the terrain. Community tokens are the species. Pools become the genetic links.
            </p>
          </div>

          <TabsContent value="biosphere">
            <SpeciesNavigator
              species={snapshot.species}
              selectedId={selected.id}
              coverage={snapshot.coverage}
              onSelect={setSelectedId}
            />
            <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_420px] xl:grid-cols-[minmax(0,1fr)_460px]">
              <AffinityField
                habitats={snapshot.habitats}
                species={snapshot.species}
                edges={snapshot.edges}
                selectedId={selected.id}
                activeHabitat={activeHabitat}
                onSelect={setSelectedId}
                onHabitatChange={setActiveHabitat}
                snapshotMode={meta.mode}
                freshnessLabel={freshnessLabel}
              />
              <SpeciesDossier
                species={selected}
                habitats={snapshot.habitats}
                sourceState={meta.reconciliation?.status === "verified" ? "contract verified" : "reference data"}
              />
            </div>
            <EngineHealthPanel engine={health?.engine} />
          </TabsContent>

          <TabsContent value="block"><ChainBlockView snapshot={snapshot} /></TabsContent>
        </Tabs>

        <footer className="mt-4 flex flex-col justify-between gap-2 border-t border-foreground/10 px-1 pt-4 font-mono text-[9px] uppercase tracking-[0.14em] text-foreground/25 sm:flex-row">
          <span>
            {freshnessLabel}
            {meta.reconciliation ? ` · RPC ${meta.reconciliation.quorum}/${meta.reconciliation.providerCount} · #${meta.reconciliation.blockNumber.toLocaleString()}` : ""}
            {meta.ledger ? ` · ledger ${meta.ledger.position} · ${meta.ledger.snapshotId.slice(0, 8)}` : ""}
          </span>
          <span>Affinity describes market adjacency—not asset backing or investment quality</span>
        </footer>
      </div>
    </main>
  );
}
