// Keep every collection comfortably inside the Worker lifetime. Frequent bounded
// commits recover faster from provider pressure than one large all-or-nothing run.
export const PONS_MAX_BLOCKS_PER_RUN = 4_000;

export type PonsCollectionStrategy = "balanced" | "live-catchup";

export function ponsCollectionBudget(lagBlocks: number) {
  if (lagBlocks > 200_000) {
    return {
      strategy: "live-catchup" as const,
      liveBlocks: 4_000,
      backfillBlocks: 0,
      metadataLimit: 5,
    };
  }

  if (lagBlocks > 40_000) {
    return {
      strategy: "live-catchup" as const,
      liveBlocks: 3_000,
      backfillBlocks: 0,
      metadataLimit: 8,
    };
  }

  return {
    strategy: "balanced" as const,
    liveBlocks: 2_000,
    backfillBlocks: 2_000,
    metadataLimit: 12,
  };
}
