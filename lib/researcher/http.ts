import { ResearchStore } from "@/db/researcher";
import { premiumResponse, PremiumRequestError } from "@/lib/entitlements/premium-boundary";
import { rejectCrossSiteMutation } from "@/lib/entitlements/request-security";
import type { PremiumAccessEvaluation } from "@/lib/entitlements/token-gate";
import { RESEARCH_LIMITS, validTaskInput, type ResearchCadence } from "./model";

async function body(request: Request): Promise<Record<string, unknown>> {
  if (!request.headers.get("content-type")?.startsWith("application/json")) throw new PremiumRequestError(415, "json_required");
  const reader = request.body?.getReader(); if (!reader) throw new PremiumRequestError(400, "invalid_assignment");
  let size = 0, value = ""; const decoder = new TextDecoder();
  try { while (true) { const chunk = await reader.read(); if (chunk.done) break; size += chunk.value.byteLength; if (size > 6000) throw new PremiumRequestError(413, "assignment_too_large"); value += decoder.decode(chunk.value, { stream: true }); } value += decoder.decode(); }
  finally { await reader.cancel().catch(() => undefined); }
  try { const parsed = JSON.parse(value); if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw Error(); return parsed; }
  catch { throw new PremiumRequestError(400, "invalid_assignment"); }
}
function identifier(value: unknown) { if (typeof value !== "string" || !/^[a-f\d-]{36}$/i.test(value)) throw new PremiumRequestError(400, "invalid_assignment"); return value; }

export function researcherResponse(request: Request, services: {
  store: ResearchStore; configured: boolean;
  authenticate: () => Promise<{ id: string } | null>;
  evaluate: (id: string) => Promise<PremiumAccessEvaluation>;
}) {
  if (request.method !== "GET") { const rejected = rejectCrossSiteMutation(request); if (rejected) return Promise.resolve(rejected); }
  return premiumResponse({ authenticate: services.authenticate, evaluate: services.evaluate, load: async user => {
    const store = services.store;
    if (request.method === "GET") {
      const id = new URL(request.url).searchParams.get("id");
      const [assignments, usage, runs] = await Promise.all([store.list(user.id), store.usage(user.id), id ? store.runs(user.id, identifier(id)) : Promise.resolve([])]);
      return { assignments, usage, runs, configured: services.configured, capacity: RESEARCH_LIMITS.assignments };
    }
    const input = await body(request);
    if (request.method === "POST" && input.action === "create") {
      let valid; try { valid = validTaskInput(input); } catch { throw new PremiumRequestError(422, "invalid_assignment"); }
      const assignment = await store.create(user.id, valid);
      return { assignment, runId: await store.enqueue(user.id, assignment.id) };
    }
    const id = identifier(input.id);
    if (request.method === "POST" && input.action === "run") {
      const assignment = await store.task(user.id, id);
      if (assignment.paused) throw new PremiumRequestError(409, "assignment_paused");
      const runId = await store.enqueue(user.id, id);
      if (!runId) throw new PremiumRequestError(429, "check_limit_or_busy");
      return { runId };
    }
    if (request.method === "PATCH") {
      if (typeof input.paused !== "boolean" || !["manual", "hourly", "daily"].includes(String(input.cadence))) throw new PremiumRequestError(422, "invalid_assignment");
      return { assignment: await store.update(user.id, id, input.paused, input.cadence as ResearchCadence) };
    }
    if (request.method === "DELETE") { await store.remove(user.id, id); return { deleted: true }; }
    throw new PremiumRequestError(400, "invalid_research_action");
  } });
}
