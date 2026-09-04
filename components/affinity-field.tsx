"use client";

import type { AffinityEdge, Habitat, SnapshotMode, Species } from "@/lib/affinity-model";

type Props = {
  habitats: Habitat[];
  species: Species[];
  edges: AffinityEdge[];
  selectedId: string;
  activeHabitat: string | null;
  onSelect: (id: string) => void;
  onHabitatChange: (symbol: string | null) => void;
  snapshotMode: SnapshotMode;
  freshnessLabel: string;
};

function connected(edge: AffinityEdge, selectedId: string, habitat: string | null) {
  return edge.speciesId === selectedId || edge.habitat === habitat;
}

export function AffinityField({
  habitats, species, edges, selectedId, activeHabitat, onSelect, onHabitatChange, snapshotMode, freshnessLabel,
}: Props) {
  const habitatMap = new Map(habitats.map((habitat) => [habitat.symbol, habitat]));
  const speciesMap = new Map(species.map((item) => [item.id, item]));
  const denseHabitatField = habitats.length > 16;
  const visibleSpecies = activeHabitat
    ? new Set(edges.filter((edge) => edge.habitat === activeHabitat).map((edge) => edge.speciesId))
    : null;

  return (
    <section className="field-grid relative min-h-[540px] overflow-hidden rounded-[10px] border border-foreground/10 bg-[var(--surface-1)]/80 lg:min-h-[650px]">
      <div className="pointer-events-none absolute inset-x-0 top-0 z-10 flex items-center justify-between border-b border-foreground/10 bg-[var(--surface-1)]/75 px-4 py-3 backdrop-blur-md">
        <div>
          <p className="font-mono text-[10px] uppercase tracking-[0.24em] text-signal">Affinity field</p>
          <p className="mt-1 text-xs text-foreground/50">Verified composition + observed market state</p>
        </div>
        <div className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.16em] text-foreground/45">
          <span className="relative flex size-2">
            {snapshotMode === "live" && <span className="absolute inline-flex size-full animate-ping rounded-full bg-signal opacity-40" />}
            <span className={`relative inline-flex size-2 rounded-full ${snapshotMode === "live" ? "bg-signal" : snapshotMode === "cached" ? "bg-culture" : "bg-foreground/35"}`} />
          </span>
          {freshnessLabel}
        </div>
      </div>

      <svg
        viewBox="0 0 1000 620"
        className="absolute inset-0 h-full w-full pt-12"
        aria-label="Interactive affinity map of community tokens and stock-token habitats"
      >
        <defs>
          <radialGradient id="fieldGlow">
            <stop offset="0%" stopColor="var(--attention)" stopOpacity="0.13" />
            <stop offset="100%" stopColor="var(--attention)" stopOpacity="0" />
          </radialGradient>
          <filter id="softGlow" x="-80%" y="-80%" width="260%" height="260%">
            <feGaussianBlur stdDeviation="7" result="blur" />
            <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
          </filter>
        </defs>

        <circle cx="500" cy="310" r="270" fill="url(#fieldGlow)" />

        {edges.map((edge) => {
          const from = speciesMap.get(edge.speciesId);
          const to = habitatMap.get(edge.habitat);
          if (!from || !to) return null;
          const isLive = connected(edge, selectedId, activeHabitat);
          const dimmed = activeHabitat && edge.habitat !== activeHabitat;
          return (
            <line
              key={edge.id}
              x1={from.x} y1={from.y} x2={to.x} y2={to.y}
              stroke={isLive ? from.color : "var(--slate)"}
              strokeWidth={isLive ? 1.8 + edge.strength / 45 : 0.8}
              strokeOpacity={dimmed ? 0.04 : isLive ? 0.82 : 0.2}
              strokeDasharray={isLive ? "5 8" : "2 9"}
              className={isLive ? "edge-flow" : undefined}
            />
          );
        })}

        {habitats.map((habitat) => {
          const active = habitat.symbol === activeHabitat;
          const related = edges.some((edge) => edge.speciesId === selectedId && edge.habitat === habitat.symbol);
          return (
            <g
              key={habitat.symbol}
              role="button"
              tabIndex={0}
              aria-label={`Filter by ${habitat.name}`}
              onClick={() => onHabitatChange(active ? null : habitat.symbol)}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  onHabitatChange(active ? null : habitat.symbol);
                }
              }}
              className="cursor-pointer outline-none"
            >
              {(active || related) && (
                <circle cx={habitat.x} cy={habitat.y} r="37" fill="none" stroke={habitat.color}
                  strokeWidth="1" opacity="0.28" className="signal-pulse" />
              )}
              <circle cx={habitat.x} cy={habitat.y} r={active ? 22 : denseHabitatField ? 16 : 20} fill="var(--surface-popover)"
                stroke={habitat.color} strokeWidth={active || related ? 2 : 1}
                opacity={activeHabitat && !active ? 0.35 : 1} />
              <text x={habitat.x} y={habitat.y + 4} textAnchor="middle" fill={habitat.color}
                fontSize="10" fontFamily="IBM Plex Mono, monospace" fontWeight="700">
                {habitat.symbol}
              </text>
              {!denseHabitatField ? (
                <text x={habitat.x} y={habitat.y + 39} textAnchor="middle" fill="var(--slate)"
                  fontSize="9" fontFamily="IBM Plex Mono, monospace">
                  {habitat.sector.toUpperCase()}
                </text>
              ) : null}
            </g>
          );
        })}

        {species.map((item, index) => {
          const selected = selectedId === item.id;
          const dimmed = visibleSpecies && !visibleSpecies.has(item.id);
          const radius = 22 + Math.min(18, Math.log10(item.marketCapUsd) * 2.4);
          return (
            <g
              key={item.id}
              role="button"
              tabIndex={0}
              aria-label={`Inspect ${item.name}`}
              onClick={() => onSelect(item.id)}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  onSelect(item.id);
                }
              }}
              className="node-breathe cursor-pointer outline-none"
              style={{ animationDelay: `${index * -0.8}s` }}
              opacity={dimmed ? 0.16 : 1}
            >
              {selected && (
                <circle cx={item.x} cy={item.y} r={radius + 15} fill="none" stroke={item.color}
                  strokeWidth="1" opacity="0.4" strokeDasharray="3 6" />
              )}
              <circle cx={item.x} cy={item.y} r={radius} fill="var(--surface-3)" stroke={item.color}
                strokeWidth={selected ? 3 : 1.5} filter={selected ? "url(#softGlow)" : undefined} />
              <circle cx={item.x - radius * 0.2} cy={item.y - radius * 0.2}
                r={Math.max(5, radius * 0.24)} fill={item.color} opacity="0.82" />
              <text x={item.x} y={item.y + 4} textAnchor="middle" fill="var(--foreground)"
                fontSize="11" fontFamily="IBM Plex Mono, monospace" fontWeight="800">
                {item.symbol}
              </text>
              <text x={item.x} y={item.y + radius + 18} textAnchor="middle" fill={item.color}
                fontSize="9" fontFamily="IBM Plex Mono, monospace">
                VITALITY {item.vitality}
              </text>
            </g>
          );
        })}
      </svg>

      <div className="absolute inset-x-3 bottom-3 z-10 flex gap-1.5 overflow-x-auto rounded-md border border-foreground/10 bg-[var(--surface-2)]/85 p-2 backdrop-blur-md [scrollbar-width:none]">
        <button type="button" onClick={() => onHabitatChange(null)}
          className={`shrink-0 rounded px-3 py-2 font-mono text-[10px] uppercase tracking-[0.12em] transition ${
            activeHabitat === null ? "bg-foreground text-background" : "bg-foreground/5 text-foreground/45 hover:text-foreground"
          }`}>
          All habitats
        </button>
        {habitats.map((habitat) => (
          <button type="button" key={habitat.symbol}
            onClick={() => onHabitatChange(habitat.symbol === activeHabitat ? null : habitat.symbol)}
            className={`shrink-0 rounded border px-3 py-2 font-mono text-[10px] uppercase tracking-[0.12em] transition ${
              activeHabitat === habitat.symbol
                ? "border-transparent text-background"
                : "border-foreground/10 bg-foreground/5 text-foreground/45 hover:border-foreground/20 hover:text-foreground"
            }`}
            style={activeHabitat === habitat.symbol ? { backgroundColor: habitat.color } : undefined}>
            {habitat.symbol}
          </button>
        ))}
      </div>
    </section>
  );
}
