import { ResearchStore } from "@/db/researcher";
import { evaluatePremiumAccess } from "@/lib/entitlements/token-gate";
import { researchModelConfig } from "./agent";
import { investigate } from "./engine";
import { boundedRead } from "./sources";
import type { ResearchReport, ResearchTask } from "./model";

export async function runNextResearch(store: ResearchStore, services: {
  eligible: (userId: string) => Promise<boolean>;
  investigate: (task: ResearchTask, previous: ResearchReport | null) => Promise<ResearchReport>;
}) {
  const job = await store.claim(); if (!job) return;
  try {
    const task = await store.task(job.userId, job.assignmentId);
    if (task.paused) { await store.finish(job, "blocked", null, "assignment_paused"); return; }
    if (!await services.eligible(job.userId)) {
      await store.update(job.userId, job.assignmentId, true, task.cadence);
      await store.finish(job, "blocked", null, "holder_access_required"); return;
    }
    const report = await services.investigate(task, await store.previous(job.userId, job.assignmentId));
    await store.finish(job, report.analysisStatus === "complete" && report.sources.every(s => s.freshness !== "unavailable") ? "complete" : "partial", report, null);
  } catch {
    await store.finish(job, "failed", null, "check_unavailable");
  }
}

/** One bounded job per wake; scheduled jobs use the same verified holder boundary. */
export async function processResearchQueue(db: D1Database, bindings: Record<string, unknown>, scheduled = false) {
  const deadline = Date.now() + 26_000, store = new ResearchStore(db);
  if (scheduled) await store.enqueueDue();
  await runNextResearch(store, {
    eligible: async userId => {
      const gate = await boundedRead(evaluatePremiumAccess({ db, userId, bindings, force: true }), Math.min(Date.now() + 6_000, deadline - 2_000));
      return gate.access.active && Boolean(gate.access.expiresAt) && Date.parse(gate.access.expiresAt!) > Date.now() + 27_000;
    },
    investigate: async (task, previous) => {
      const [{ lookupToken }, { servePonsState }, { readPremiumDossier }, { refreshRecentCurveCheck }] = await Promise.all([
        import("@/lib/tokens/discovery"), import("@/lib/ingestion/pons-live"), import("@/db/premium-research"), import("@/db/premium-recent-curve"),
      ]);
      return investigate(task, previous, { lookup: lookupToken,
        dossier: async token => readPremiumDossier(await servePonsState(undefined, token), { token, cursor: null, through: null, windowBlocks: 25_000, kind: "all", scope: "window" }),
        recent: refreshRecentCurveCheck, config: researchModelConfig(bindings), deadline });
    },
  });
}
