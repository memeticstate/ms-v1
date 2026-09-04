# Memetic State — Robinhood Evidence Engine v2

## What the graph means

Memetic State maps market adjacency on Robinhood Chain. It does not infer asset ownership, collateral, reserves, endorsement, or investment quality.

| Graph primitive | Evidence | Meaning |
| --- | --- | --- |
| Species | PAIR token contract + PAIR discovery/metrics APIs | A community token with an observable market surface |
| Habitat | Robinhood `/assets` registry + Stock Token contract | A verified Robinhood Stock Token selected by a species' pools |
| Edge | Canonical PAIR V5 pool `weightBps` | The species' declared affinity weight to a habitat |
| State | PAIR market data, Robinhood quotes, registry, RPC quorum | One time-bounded, reconciled observation of the graph |
| Chain Block | Deterministic comparison with verified history | A material transition in topology, declared weights, or market regime |

The relationship itself is the product primitive: which communities attach to which tokenized companies, with what declared weight, and how those communities behave over time.

## Collection topology

Three triggers converge on one durable lease:

1. Native five-minute scheduled event.
2. Request watchdog on snapshot traffic when the last successful state is stale.
3. Owner-triggered forced wake at `POST /api/collector/wake`.

The lease is held in D1. Only one trigger can collect, reconcile, and commit at a time. Each attempt receives a run ID and persists its trigger, phase, duration, source observations, record counts, freshness, warnings, and bounded error code.

## Evidence lanes

### Market heartbeat

- Discovers the top 50 PAIR species by market cap from a protocol universe currently exposed by the API.
- Rejects hidden/flagged entries, stale market data, incomplete canonical weights, weights that do not sum to 10,000 bps, and habitats that do not match Robinhood's symbol/address registry.
- Maintains a 12-species cohort with replacement hysteresis: selected species remain while they are eligible and within a wider rank band; new replacements normally qualify across two observations.
- Loads per-species metrics with validated discovery-field fallbacks.

### Robinhood registry and corporate actions

- Refreshes `/assets` at a 55-minute boundary and stores normalized assets, contracts, multipliers, pending multiplier changes, tradability, decimals, ISIN and content hashes.
- Loads `/corporate-actions` on the same refresh lane and deduplicates by Robinhood's stable action UID.
- Uses the durable registry when a refresh fails, while marking the source stale rather than pretending it is live.

### Quotes and multiplier normalization

- Requests only the habitats used by the selected cohort.
- Stores raw underlying bid/ask, generation time, volume, halt state and spread.
- Applies `currentMultiplier` to derive the token-equivalent quote because the Robinhood REST price surface is not multiplier adjusted.
- Reads `uiMultiplier()` from every selected Stock Token at the quorum block and compares it with `/assets`. A mismatch is a critical engine alert.

### Chain reconciliation

- Reads heads from five independent Robinhood Chain RPC providers.
- Requires at least three providers to agree on one historical block and evidence fingerprint.
- Verifies each community token has deployed bytecode and that its launch receipt contains logs emitted by its contract.
- Caches immutable contract/launch attestations for six hours; current heads and Stock Token multipliers are still checked every run.

## Observed metrics

The engine publishes formulas rather than aesthetic scores:

- **Affinity balance** — normalized concentration of declared pool weights; a single-habitat species receives a bounded concentration score rather than being presented as diversified.
- **Market vitality** — weighted, bounded combination of observed volume, trade count, depth and turnover.
- **Market stress** — weighted, bounded combination of depth thinness, absolute 24-hour movement and excessive turnover velocity.
- **Turnover** — 24-hour volume / market cap, stored and displayed as a percentage.
- **Depth ratio** — verified market depth / market cap, stored and displayed as a percentage.
- **Depth ratio** — total declared-pool depth / market cap.
- **Evidence confidence** — observed-field completeness combined with registry, quote, multiplier and RPC evidence.

These are descriptive state features, not return forecasts.

## Chain Block v2

The deterministic engine evaluates all drivers in a state, not only the first match:

- Any verified species/edge addition or removal is a topology driver.
- A five-percentage-point declared-weight move is an affinity driver.
- A 25% market-cap or 50% volume move against the previous verified state is an immediate market driver.
- After three observations, 15% market-cap or 35% volume deviation from the rolling median is a regime driver.

All simultaneous drivers are retained. A stable priority rule names the block, while its full evidence, thresholds, confidence, baseline window and snapshot lineage remain durable.

## Durable model

- `affinity_snapshots` — immutable full state and provenance.
- `species_observations` / `affinity_edge_observations` — queryable time series.
- `chain_blocks` — material transitions only.
- `collection_runs` / `source_observations` — run and source telemetry.
- `robinhood_assets` / `robinhood_quotes` / `robinhood_corporate_actions` — normalized Robinhood evidence.
- `contract_attestations` — reusable code and launch proofs.
- `cohort_members` — cohort stability state.
- `engine_alerts` — deduplicated, resolvable anomalies.

Quotes are retained for 30 days, run telemetry for 90 days, and verified graph snapshots for 180 days. Chain Blocks remain attached to their source snapshots within that bounded archive.

## Adapter boundary and Pons

The canonical model supports protocol IDs independently of PAIR. A future Pons adapter should emit the same `Species`, `AffinityEdge`, source telemetry and evidence contracts, but must not be blended into the PAIR cohort until Pons exposes comparably verifiable identity, relationship and market primitives. The engine is Robinhood-native; PAIR is its first graph-producing adapter, not its permanent boundary.
