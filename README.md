# Memetic State

Memetic State is a Robinhood Chain market-intelligence engine. It maps community-token species to verified Stock Token habitats through canonical pool weights, then records how that relationship graph changes over time.

The product is intentionally descriptive. An affinity edge means market adjacency declared by a pool; it does not mean ownership, collateral, asset backing, endorsement, or investment quality.

## Engine surfaces

- `/` — biosphere, 12-species cohort navigator, evidence-rich dossier, Chain Block view and engine telemetry.
- `/api/affinity-snapshot` — latest verified immutable state; snapshot traffic activates the stale watchdog.
- `/api/affinity-history` — durable snapshot lineage.
- `/api/species-history` — queryable per-species observations.
- `/api/chain-blocks` — material deterministic transitions.
- `/api/affinity-health` and `/api/engine-health` — collector, source, RPC, archive, registry and alert telemetry.
- `POST /api/collector/wake` — owner-triggered forced collection, still protected by the single-writer lease.

## Collection

Native five-minute schedules, request traffic and manual wakes converge on one D1 lease. A full run performs PAIR discovery, stable-cohort selection, per-species metrics, Robinhood registry/corporate-action refresh, selected-habitat quotes, multi-provider RPC consensus, contract/launch attestation and Stock Token multiplier reconciliation before committing.

See [docs/mvp-architecture.md](docs/mvp-architecture.md) for exact graph semantics, formulas, evidence lanes, thresholds, retention and the adapter path beyond PAIR.

## Commands

- `npm run dev` — local Vite/Vinext worker.
- `npm run build` — bounded production build.
- `npm run lint` — source lint.
- `npm test` — production build plus deterministic engine, boundary, UI and rendered-HTML tests.
- `npm run db:generate` — generate a new Drizzle migration after changing `db/schema.ts`.

The deploy target is OpenAI Sites with a D1 binding named `DB`. Runtime bindings are injected by `worker/index.ts` before route dispatch so both fetch and scheduled execution use the same database instance.
