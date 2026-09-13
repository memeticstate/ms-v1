import { env } from "cloudflare:workers";
import { z } from "zod";
import { authenticateMember } from "@/lib/auth/server";
import { evaluatePremiumAccess } from "@/lib/entitlements/token-gate";
import { premiumResponse, PremiumRequestError } from "@/lib/entitlements/premium-boundary";
import { rejectCrossSiteMutation } from "@/lib/entitlements/request-security";
import { servePonsState } from "@/lib/ingestion/pons-live";
import { readPremiumDossier } from "@/db/premium-research";
import { listResearchCases, readResearchCase, createResearchCase, updateResearchCase, reviewResearchCase, deleteResearchCase } from "@/db/premium-cases";
import { CASE_LIMIT, caseId, createCaseInput, updateCaseInput, reviewCaseInput, researchQueryForCase, captureCaseEvidence, readCaseBody } from "@/lib/premium/cases";

function parse<S extends z.ZodTypeAny>(schema: S, value: unknown): z.infer<S> { const parsed = schema.safeParse(value); if (!parsed.success) throw new PremiumRequestError(422, "invalid_case"); return parsed.data; }
function route(request: Request, load: (user: { id: string }) => Promise<Record<string, unknown>>) {
  const bindings = env as unknown as Record<string, unknown>;
  return premiumResponse({ authenticate: () => authenticateMember({ request, db: env.DB, bindings, forceIdentitySync: true }), evaluate: userId => evaluatePremiumAccess({ db: env.DB, userId, bindings }), load });
}
export async function GET(request: Request) {
  return route(request, async user => {
    const id = new URL(request.url).searchParams.get("id");
    return id ? { caseFile: await readResearchCase(user.id, parse(caseId, id)) } : { cases: await listResearchCases(user.id), capacity: CASE_LIMIT };
  });
}
export async function POST(request: Request) {
  const rejection = rejectCrossSiteMutation(request); if (rejection) return rejection;
  return route(request, async user => {
    const input = parse(createCaseInput, await readCaseBody(request));
    const query = researchQueryForCase(input.query);
    const state = await servePonsState(undefined, query.token);
    const dossier = await readPremiumDossier(state, query);
    if (!dossier) throw new PremiumRequestError(404, "token_not_indexed");
    if (dossier.coverage.throughBlock !== input.query.through) throw new PremiumRequestError(409, "evidence_window_changed");
    return { caseFile: await createResearchCase(user.id, input, captureCaseEvidence(dossier, input.evidenceIds)) };
  });
}
export async function PATCH(request: Request) {
  const rejection = rejectCrossSiteMutation(request); if (rejection) return rejection;
  return route(request, async user => {
    const body = await readCaseBody(request);
    if (body?.action === "review") {
      const input = parse(reviewCaseInput, body);
      const existing = await readResearchCase(user.id, input.id);
      if (existing.version !== input.version) throw new PremiumRequestError(409, "case_changed_reload");
      const query = researchQueryForCase(existing.query, true);
      const state = await servePonsState(undefined, query.token);
      const dossier = await readPremiumDossier(state, query);
      if (!dossier) throw new PremiumRequestError(404, "token_not_indexed");
      return { caseFile: await reviewResearchCase(user.id, input.id, input.version, captureCaseEvidence(dossier)) };
    }
    const input = parse(updateCaseInput, body);
    return { caseFile: await updateResearchCase(user.id, input.id, input.version, input) };
  });
}
export async function DELETE(request: Request) {
  const rejection = rejectCrossSiteMutation(request); if (rejection) return rejection;
  return route(request, async user => {
    const input = parse(z.object({ id: caseId, version: z.number().int().positive() }), await readCaseBody(request));
    await deleteResearchCase(user.id, input.id, input.version); return { deleted: true };
  });
}
