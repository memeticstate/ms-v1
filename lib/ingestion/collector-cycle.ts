import { runAffinityCollection } from "@/lib/ingestion/pair-live";
import { runPonsHistoryCollection } from "@/lib/ingestion/pons-history";
import { materializePonsState, runPonsCollection } from "@/lib/ingestion/pons-live";
import { runFactoryCollection } from "@/lib/ingestion/pons-factory";
import { runTokenResearch } from "@/lib/ingestion/pons-research";
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
  options: { force?: boolean; includeEvidence?: boolean; includeFactory?: boolean } = {},
) {
  const results: Array<Awaited<ReturnType<typeof capture>>> = [];
  if (options.includeFactory ?? true) results.push(await capture("pons-factory-live", runFactoryCollection));
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

async function withScheduledResearch(
  results: Array<Awaited<ReturnType<typeof capture>>>,
) {
  // Holder evidence follows the minute's primary RPC lane instead of competing
  // with it. Two sequential attention-ranked reads give the sustained cohort
  // enough throughput to remain inside the ten-minute evidence window.
  for (let slot = 0; slot < 2; slot++) {
    const research = await capture(
      `pons-research-${slot + 1}`,
      () => runTokenResearch(undefined, { intervalMs: 0 }),
    );
    results.push(research);

    // Stop early when no eligible stale candidate remains.
    if (
      research.status === "fulfilled"
      && research.value.status === "skipped"
      && research.value.reason === "already_fresh_or_not_indexed"
    ) {
      break;
    }
  }

  return results;
}

export async function runScheduledCollectorCycle(scheduledTime: number) {
  const factory = await capture("pons-factory-live", runFactoryCollection);
  const minuteSlot = Math.floor(scheduledTime / 60_000) % 5;
  // Give each expensive lane its own Worker invocation budget. This prevents a
  // slow evidence refresh from canceling the live PONS commit that follows it.
  if (minuteSlot === 0) {
    return withScheduledResearch([factory, await capture("robinhood-evidence", () => runAffinityCollection("scheduled"))]);
  }
  if (minuteSlot === 2) return withScheduledResearch([factory, await runHistoryCollectorCycle("scheduled", "v1-current")]);
  if (minuteSlot === 4) return withScheduledResearch([factory, await runHistoryCollectorCycle("scheduled", "v1-legacy")]);
  const live = await capture("pons-v2", () => runPonsCollection("scheduled"));

  // Keep the durable public state artifact aligned with the canonical live
  // cursor. Materialization is downstream of a successful PONS commit, never
  // a prerequisite for the collector itself to succeed.
  if (live.status === "fulfilled" && live.value.status === "recorded") {
    const materialized = await capture("pons-materialize", () => materializePonsState());
    return withScheduledResearch([factory, live, materialized]);
  }

  return withScheduledResearch([factory, live]);
}
