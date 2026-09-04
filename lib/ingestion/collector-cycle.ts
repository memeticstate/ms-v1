import { runAffinityCollection } from "@/lib/ingestion/pair-live";
import { runPonsHistoryCollection } from "@/lib/ingestion/pons-history";
import { runPonsCollection } from "@/lib/ingestion/pons-live";
import type { PonsV1GenerationId } from "@/lib/pons/constants";
import type { CollectionTrigger } from "@/db/engine-ledger";

async function capture<T>(label: string, operation: () => Promise<T>) {
  try {
    return { label, status: "fulfilled" as const, value: await operation() };
  } catch (error) {
    console.error(`${label} collection failed`, error);
    return {
      label,
      status: "rejected" as const,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export async function runPrimaryCollectorCycle(
  trigger: CollectionTrigger,
  options: { force?: boolean; includeEvidence?: boolean } = {},
) {
  const results: Array<Awaited<ReturnType<typeof capture>>> = [];
  // Sequential lanes avoid making the same public RPC providers rate-limit each other.
  if (options.includeEvidence ?? true) {
    results.push(await capture("robinhood-evidence", () => runAffinityCollection(trigger, { force: options.force })));
  }
  results.push(await capture("pons-v2", () => runPonsCollection(trigger, { force: options.force })));
  return results;
}

export async function runHistoryCollectorCycle(
  trigger: CollectionTrigger,
  generationId: PonsV1GenerationId,
  force = false,
) {
  return capture(`pons-${generationId}`, () => runPonsHistoryCollection(trigger, generationId, { force }));
}

export async function runScheduledCollectorCycle(scheduledTime: number) {
  const minuteSlot = Math.floor(scheduledTime / 60_000) % 5;
  // Give each expensive lane its own Worker invocation budget. This prevents a
  // slow evidence refresh from canceling the live PONS commit that follows it.
  if (minuteSlot === 0) {
    return [await capture("robinhood-evidence", () => runAffinityCollection("scheduled"))];
  }
  if (minuteSlot === 2) return [await runHistoryCollectorCycle("scheduled", "v1-current")];
  if (minuteSlot === 4) return [await runHistoryCollectorCycle("scheduled", "v1-legacy")];
  return runPrimaryCollectorCycle("scheduled", { includeEvidence: false });
}
