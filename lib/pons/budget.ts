// Keep every collection comfortably inside the Worker lifetime. Frequent bounded
// commits recover faster from provider pressure than one large all-or-nothing run.
export const PONS_MAX_BLOCKS_PER_RUN = 2_000;

export type PonsCollectionStrategy = "balanced" | "live-catchup";

export function ponsCollectionBudget(lagBlocks: number) {
  // The scheduled V2 lane only receives a subset of minute slots. While the
  // canonical cursor is materially behind, spend the whole bounded run on the
  // live edge so chain growth cannot outrun collection throughput.
  if (lagBlocks > 2_000) {
    return {
      strategy: "live-catchup" as const,
      liveBlocks: 2_000,
      backfillBlocks: 0,
      metadataLimit: 2,
    };
  }

  // Near the head, keep a little live-rate headroom while resuming historical
  // memory construction. The total remains capped at PONS_MAX_BLOCKS_PER_RUN.
  return {
    strategy: "balanced" as const,
    liveBlocks: 1_600,
    backfillBlocks: 400,
    metadataLimit: 5,
  };
}
