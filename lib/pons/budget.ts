// Keep every collection comfortably inside the Worker lifetime. Frequent bounded
// commits recover faster from provider pressure than one large all-or-nothing run.
export const PONS_MAX_BLOCKS_PER_RUN = 3_000;

export type PonsCollectionStrategy = "balanced" | "live-catchup";

export function ponsCollectionBudget(lagBlocks: number) {
  if (lagBlocks > 200_000) {
    return {
      strategy: "live-catchup" as const,
      liveBlocks: 3_000,
      backfillBlocks: 0,
      metadataLimit: 3,
    };
  }

  if (lagBlocks > 40_000) {
    return {
      strategy: "live-catchup" as const,
      liveBlocks: 2_500,
      backfillBlocks: 0,
      metadataLimit: 5,
    };
  }

  return {
    strategy: "balanced" as const,
    liveBlocks: 1_500,
    backfillBlocks: 1_500,
    metadataLimit: 8,
  };
}
