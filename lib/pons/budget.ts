// Keep every collection comfortably inside the Worker lifetime. Frequent bounded
// commits recover faster from provider pressure than one large all-or-nothing run.
export const PONS_MAX_BLOCKS_PER_RUN = 2_000;
export const PONS_LIVE_CATCHUP_THRESHOLD_BLOCKS = 2_000;

export type PonsCollectionStrategy = "balanced" | "live-catchup";

export function ponsCollectionBudget(lagBlocks: number) {
  // While the canonical index is materially behind the safe head, spend the
  // entire bounded run budget on the live edge. Historical backfill resumes
  // only after the live cursor is close enough that it can remain current.
  if (lagBlocks > PONS_LIVE_CATCHUP_THRESHOLD_BLOCKS) {
    return {
      strategy: "live-catchup" as const,
      liveBlocks: PONS_MAX_BLOCKS_PER_RUN,
      backfillBlocks: 0,
      metadataLimit: 2,
    };
  }

  return {
    strategy: "balanced" as const,
    liveBlocks: 1_000,
    backfillBlocks: 1_000,
    metadataLimit: 5,
  };
}
