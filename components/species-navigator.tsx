"use client";

import { useMemo, useState } from "react";
import { Search } from "lucide-react";

import { Input } from "@/components/ui/input";
import type { SnapshotCoverage, Species } from "@/lib/affinity-model";

const compactUsd = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  notation: "compact",
  maximumFractionDigits: 1,
});

export function SpeciesNavigator({
  species,
  selectedId,
  coverage,
  onSelect,
}: {
  species: Species[];
  selectedId: string;
  coverage?: SnapshotCoverage;
  onSelect: (id: string) => void;
}) {
  const [query, setQuery] = useState("");
  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return species;
    return species.filter((item) => (
      item.symbol.toLowerCase().includes(needle)
      || item.name.toLowerCase().includes(needle)
      || item.genome.some((gene) => gene.habitat.toLowerCase().includes(needle))
    ));
  }, [query, species]);

  return (
    <section className="mb-3 overflow-hidden rounded-[10px] border border-foreground/10 bg-[var(--surface-2)]/86">
      <div className="flex flex-col gap-3 border-b border-foreground/10 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <div>
            <p className="font-mono text-[9px] uppercase tracking-[0.2em] text-signal">Verified observation cohort</p>
            <p className="mt-1 text-xs text-foreground/42">
              {coverage
                ? `${coverage.observedSpecies} deeply observed from ${coverage.discoveredSpecies.toLocaleString()} discovered PAIR species`
                : `${species.length} reference species`}
            </p>
          </div>
          {coverage ? (
            <span className="hidden rounded-full border border-foreground/10 px-2.5 py-1 font-mono text-[8px] uppercase tracking-[0.12em] text-foreground/30 lg:inline-flex">
              ranked by market cap
            </span>
          ) : null}
        </div>
        <div className="relative w-full sm:w-64">
          <Search aria-hidden="true" className="absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-foreground/25" />
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Find species or habitat"
            aria-label="Find a species or habitat"
            className="h-9 border-foreground/10 bg-black/15 pl-9 font-mono text-[10px] placeholder:text-foreground/20"
          />
        </div>
      </div>

      <div className="flex min-h-[88px] gap-px overflow-x-auto bg-foreground/8 [scrollbar-width:thin]">
        {filtered.map((item) => {
          const selected = selectedId === item.id;
          const change = `${item.change24h >= 0 ? "+" : ""}${item.change24h.toFixed(1)}%`;
          return (
            <button
              type="button"
              key={item.id}
              onClick={() => onSelect(item.id)}
              aria-pressed={selected}
              className={`group min-w-[168px] flex-1 px-4 py-3 text-left transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-signal ${
                selected ? "bg-foreground text-background" : "bg-[var(--surface-2)] text-foreground hover:bg-[var(--surface-3)]"
              }`}
            >
              <div className="flex items-center justify-between gap-3">
                <span className={`font-mono text-[8px] uppercase tracking-[0.14em] ${selected ? "text-black/35" : "text-foreground/25"}`}>
                  #{item.rank ?? species.indexOf(item) + 1}
                </span>
                <span className={`font-mono text-[9px] ${item.change24h >= 0 ? "text-signal" : "text-danger"}`}>
                  {change}
                </span>
              </div>
              <div className="mt-2 flex items-end justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold tracking-tight">{item.symbol}</p>
                  <p className={`mt-0.5 truncate text-[10px] ${selected ? "text-black/42" : "text-foreground/30"}`}>{item.name}</p>
                </div>
                <p className={`shrink-0 font-mono text-[10px] ${selected ? "text-black/58" : "text-foreground/55"}`}>
                  {compactUsd.format(item.marketCapUsd)}
                </p>
              </div>
              <div className="mt-2 h-px overflow-hidden bg-current opacity-10">
                <span className="block h-full" style={{ width: `${item.metrics?.dataCompleteness ?? 50}%`, backgroundColor: item.color }} />
              </div>
            </button>
          );
        })}
        {filtered.length === 0 ? (
          <div className="grid min-w-full place-items-center bg-[var(--surface-2)] px-4 py-6 font-mono text-[10px] uppercase tracking-[0.15em] text-foreground/30">
            No species matches this query
          </div>
        ) : null}
      </div>
    </section>
  );
}
