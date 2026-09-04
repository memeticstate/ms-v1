import { z } from "zod";

import { getD1 } from "@/db";
import { recordSourceObservation } from "@/db/engine-ledger";
import type { RobinhoodAsset } from "@/lib/ingestion/robinhood-data";
import { fetchJsonWithPolicy, upstreamErrorCode } from "@/lib/ingestion/resilient-fetch";

const PAIR_API = "https://pair.fund/api/tokens";
const DISCOVERY_LIMIT = 50;
const COHORT_SIZE = 12;
const MAX_MARKET_AGE_MS = 20 * 60 * 1000;

const decimal = z.union([z.string(), z.number()]).transform(Number).pipe(z.number().finite());
const nonnegativeDecimal = decimal.pipe(z.number().nonnegative());
const nullableDecimal = decimal.nullable();
const nullableNonnegativeDecimal = nonnegativeDecimal.nullable();

const pairSchema = z.object({
  quoteToken: z.object({
    symbol: z.string().min(1),
    address: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
  }),
  weightBps: z.number().int().positive().max(10_000),
  canonical: z.boolean().optional().default(true),
  liquidityUsd: nullableNonnegativeDecimal.optional(),
  totalDepthUsd: nullableNonnegativeDecimal.optional(),
  activeVirtualSwapDepthUsd: nullableNonnegativeDecimal.optional(),
});

const tokenSchema = z.object({
  address: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
  name: z.string().min(1),
  symbol: z.string().min(1),
  pairs: z.array(pairSchema).max(5),
  totalDepthUsd: nullableNonnegativeDecimal.optional(),
  activeVirtualSwapDepthUsd: nullableNonnegativeDecimal.optional(),
  marketCapUsd: nonnegativeDecimal,
  volume24hUsd: nullableNonnegativeDecimal,
  priceUsd: nullableNonnegativeDecimal.optional(),
  change24hPct: nullableDecimal,
  graduated: z.boolean(),
  hidden: z.boolean(),
  flagged: z.boolean(),
  marketDataSource: z.string().min(1).nullable(),
  marketDataUpdatedAt: z.string().datetime().nullable(),
  launchTxHash: z.string().regex(/^0x[a-fA-F0-9]{64}$/),
  launchedAt: z.number().int().positive().optional(),
  creator: z.string().regex(/^0x[a-fA-F0-9]{40}$/).optional(),
});

const discoverySchema = z.object({
  items: z.array(tokenSchema),
  total: z.number().int().nonnegative(),
  page: z.number().int(),
  limit: z.number().int(),
});

export function parsePairDiscoveryPayload(value: unknown) {
  return discoverySchema.parse(value);
}

const metricsSchema = z.object({
  address: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
  marketCapUsd: nullableNonnegativeDecimal.optional(),
  volume24hUsd: nullableNonnegativeDecimal.optional(),
  liquidityUsd: nullableNonnegativeDecimal.optional(),
  totalDepthUsd: nullableNonnegativeDecimal.optional(),
  activeVirtualSwapDepthUsd: nullableNonnegativeDecimal.optional(),
  priceUsd: nullableNonnegativeDecimal.optional(),
  change24hPct: nullableDecimal.optional(),
  trades24h: z.number().int().nonnegative().nullable().optional(),
  marketDataSource: z.string().nullable().optional(),
  marketDataUpdatedAt: z.string().datetime().nullable().optional(),
});

type RawPairToken = z.infer<typeof tokenSchema>;
type EligiblePairToken = RawPairToken & {
  volume24hUsd: number;
  change24hPct: number;
  marketDataSource: string;
  marketDataUpdatedAt: string;
};
type RankedPairToken = EligiblePairToken & { rank: number; selectionScore: number };

export type ObservedPairToken = EligiblePairToken & {
  rank: number;
  liquidityUsd: number;
  totalDepthUsd: number;
  activeVirtualSwapDepthUsd: number;
  trades24h?: number;
  selectionScore: number;
};

type CohortRow = {
  contract_address: string;
  selected: number;
  eligible_streak: number;
  last_rank: number | null;
};

function selectionScore(token: RawPairToken) {
  const depth = token.totalDepthUsd ?? token.pairs.reduce((sum, pair) => sum + (pair.totalDepthUsd ?? 0), 0);
  const market = Math.log10(token.marketCapUsd + 1) / 8;
  const flow = Math.log10((token.volume24hUsd ?? 0) + 1) / 8;
  const depthScore = Math.log10(depth + 1) / 7;
  const multiHabitat = Math.min(token.pairs.filter((pair) => pair.canonical).length, 4) / 4;
  return Math.max(0, Math.min(100, (market * 0.42 + flow * 0.28 + depthScore * 0.2 + multiHabitat * 0.1) * 100));
}

export function pairSpeciesId(token: Pick<RawPairToken, "symbol" | "address">) {
  const slug = token.symbol.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "species";
  return `${slug}-${token.address.slice(-5).toLowerCase()}`;
}

function eligible(token: RawPairToken, registry: Map<string, RobinhoodAsset>): token is EligiblePairToken {
  if (token.hidden || token.flagged || token.marketCapUsd <= 0) return false;
  if (token.volume24hUsd === null || token.change24hPct === null || !token.marketDataSource || !token.marketDataUpdatedAt) return false;
  if (Date.now() - new Date(token.marketDataUpdatedAt).getTime() > MAX_MARKET_AGE_MS) return false;
  const canonical = token.pairs.filter((pair) => pair.canonical);
  if (!canonical.length || canonical.reduce((sum, pair) => sum + pair.weightBps, 0) !== 10_000) return false;
  return canonical.every((pair) => {
    const asset = registry.get(pair.quoteToken.symbol);
    return asset?.contractAddress.toLowerCase() === pair.quoteToken.address.toLowerCase();
  });
}

async function loadCohortState() {
  const rows = await getD1().prepare(`SELECT contract_address, selected, eligible_streak, last_rank
    FROM cohort_members`).all<CohortRow>();
  return new Map(rows.results.map((row) => [row.contract_address.toLowerCase(), row]));
}

function selectStableCohort(tokens: RankedPairToken[], state: Map<string, CohortRow>) {
  const selectedBefore = new Set([...state.values()].filter((row) => row.selected).map((row) => row.contract_address.toLowerCase()));
  if (!selectedBefore.size) return tokens.slice(0, COHORT_SIZE);

  const retained = tokens.filter((token) => selectedBefore.has(token.address.toLowerCase()) && token.rank <= COHORT_SIZE * 2);
  const retainedAddresses = new Set(retained.map((token) => token.address.toLowerCase()));
  const established = tokens.filter((token) => {
    if (retainedAddresses.has(token.address.toLowerCase())) return false;
    return (state.get(token.address.toLowerCase())?.eligible_streak ?? 0) >= 1;
  });
  const fallback = tokens.filter((token) => !retainedAddresses.has(token.address.toLowerCase()) && !established.includes(token));
  return [...retained, ...established, ...fallback].slice(0, COHORT_SIZE);
}

async function persistCohort(
  candidates: RankedPairToken[],
  selected: RankedPairToken[],
) {
  const db = getD1();
  const now = Date.now();
  const selectedAddresses = new Set(selected.map((token) => token.address.toLowerCase()));
  const candidateAddresses = new Set(candidates.map((token) => token.address.toLowerCase()));
  const statements = candidates.map((token) => {
    const isSelected = selectedAddresses.has(token.address.toLowerCase());
    return db.prepare(`INSERT INTO cohort_members
      (contract_address, species_id, symbol, selected, eligible_streak, miss_streak, last_rank, selection_score,
       first_seen_at, last_seen_at, selected_since, metadata_json)
      VALUES (?, ?, ?, ?, 1, 0, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(contract_address) DO UPDATE SET
        species_id = excluded.species_id, symbol = excluded.symbol, selected = excluded.selected,
        eligible_streak = cohort_members.eligible_streak + 1, miss_streak = 0, last_rank = excluded.last_rank,
        selection_score = excluded.selection_score, last_seen_at = excluded.last_seen_at,
        selected_since = CASE
          WHEN excluded.selected = 0 THEN NULL
          WHEN cohort_members.selected = 1 THEN cohort_members.selected_since
          ELSE excluded.selected_since END,
        metadata_json = excluded.metadata_json`)
      .bind(
        token.address.toLowerCase(),
        pairSpeciesId(token),
        token.symbol,
        isSelected ? 1 : 0,
        token.rank,
        token.selectionScore,
        now,
        now,
        isSelected ? now : null,
        JSON.stringify({ habitats: token.pairs.filter((pair) => pair.canonical).map((pair) => pair.quoteToken.symbol) }),
      );
  });
  statements.push(db.prepare(`UPDATE cohort_members
    SET selected = 0, selected_since = NULL, eligible_streak = 0, miss_streak = miss_streak + 1
    WHERE last_seen_at < ?`).bind(now));
  for (const group of Array.from({ length: Math.ceil(statements.length / 75) }, (_, index) => statements.slice(index * 75, (index + 1) * 75))) {
    await db.batch(group);
  }
  return candidateAddresses.size;
}

async function mapConcurrent<T, R>(items: T[], concurrency: number, transform: (item: T) => Promise<R>) {
  const output: R[] = new Array(items.length);
  let cursor = 0;
  async function worker() {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      output[index] = await transform(items[index]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, () => worker()));
  return output;
}

export async function collectPairCohort(runId: string, assets: RobinhoodAsset[]) {
  const registry = new Map(assets.map((asset) => [asset.tokenSymbol, asset]));
  const discoveryStarted = Date.now();
  const { data, telemetry } = await fetchJsonWithPolicy<unknown>(
    `${PAIR_API}?sort=market_cap&limit=${DISCOVERY_LIMIT}&page=1`,
    { timeoutMs: 20_000, attempts: 2 },
  );
  const discovery = parsePairDiscoveryPayload(data);
  const ranked = discovery.items.map((token, index) => ({ ...token, rank: index + 1, selectionScore: selectionScore(token) }));
  const candidates = ranked.filter((token): token is RankedPairToken => eligible(token, registry));
  const state = await loadCohortState();
  const selected = selectStableCohort(candidates, state);
  await persistCohort(candidates, selected);
  const freshnessMs = selected.length
    ? Math.max(...selected.map((token) => Date.now() - new Date(token.marketDataUpdatedAt).getTime()))
    : null;
  await recordSourceObservation(runId, {
    source: "pair-discovery",
    status: selected.length >= Math.min(4, COHORT_SIZE) ? "ok" : selected.length ? "stale" : "failed",
    startedAt: discoveryStarted,
    completedAt: telemetry.completedAt,
    freshnessMs,
    recordCount: selected.length,
    metadata: {
      attempts: telemetry.attempts,
      protocolTotal: discovery.total,
      inspected: discovery.items.length,
      eligible: candidates.length,
      selected: selected.length,
      strategy: "top-market cohort with two-cycle replacement hysteresis",
    },
  });
  if (!selected.length) throw new Error("no registry-linked PAIR species passed cohort validation");

  const metricsStarted = Date.now();
  const failures: Array<{ symbol: string; code: string }> = [];
  const observations = await mapConcurrent(selected, 6, async (token) => {
    try {
      const { data: metricsRaw } = await fetchJsonWithPolicy<unknown>(`${PAIR_API}/${token.address}/metrics`, {
        timeoutMs: 12_000,
        attempts: 2,
      });
      const metrics = metricsSchema.parse(metricsRaw);
      if (metrics.address.toLowerCase() !== token.address.toLowerCase()) throw new Error("metrics_identity_mismatch");
      return { token, metrics };
    } catch (error) {
      failures.push({ symbol: token.symbol, code: upstreamErrorCode(error) });
      return { token, metrics: null };
    }
  });

  const tokens: ObservedPairToken[] = observations.map(({ token, metrics }) => {
    const pairLiquidity = token.pairs.reduce((sum, pair) => sum + (pair.liquidityUsd ?? 0), 0);
    const pairDepth = token.pairs.reduce((sum, pair) => sum + (pair.totalDepthUsd ?? 0), 0);
    const pairActiveDepth = token.pairs.reduce((sum, pair) => sum + (pair.activeVirtualSwapDepthUsd ?? 0), 0);
    return {
      ...token,
      pairs: token.pairs.filter((pair) => pair.canonical),
      marketCapUsd: metrics?.marketCapUsd ?? token.marketCapUsd,
      volume24hUsd: metrics?.volume24hUsd ?? token.volume24hUsd,
      liquidityUsd: metrics?.liquidityUsd ?? pairLiquidity,
      totalDepthUsd: metrics?.totalDepthUsd ?? token.totalDepthUsd ?? pairDepth,
      activeVirtualSwapDepthUsd: metrics?.activeVirtualSwapDepthUsd ?? token.activeVirtualSwapDepthUsd ?? pairActiveDepth,
      priceUsd: metrics?.priceUsd ?? token.priceUsd,
      change24hPct: metrics?.change24hPct ?? token.change24hPct,
      trades24h: metrics?.trades24h ?? undefined,
      marketDataSource: metrics?.marketDataSource ?? token.marketDataSource,
      marketDataUpdatedAt: metrics?.marketDataUpdatedAt ?? token.marketDataUpdatedAt,
    };
  });
  await recordSourceObservation(runId, {
    source: "pair-metrics",
    status: failures.length === tokens.length ? "failed" : failures.length ? "stale" : "ok",
    startedAt: metricsStarted,
    completedAt: Date.now(),
    freshnessMs: tokens.length ? Math.max(...tokens.map((token) => Date.now() - new Date(token.marketDataUpdatedAt).getTime())) : null,
    recordCount: tokens.length - failures.length,
    errorCode: failures.length ? "partial_metrics_failure" : null,
    metadata: { selected: tokens.length, fallbacks: failures },
  });

  return {
    tokens,
    coverage: {
      discoveredSpecies: discovery.total,
      inspectedSpecies: discovery.items.length,
      eligibleSpecies: candidates.length,
      excludedIncomplete: discovery.items.length - candidates.length,
    },
  };
}
