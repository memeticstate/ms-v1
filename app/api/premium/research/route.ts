import { env } from "cloudflare:workers";
import { authenticateMember } from "@/lib/auth/server";
import { evaluatePremiumAccess } from "@/lib/entitlements/token-gate";
import { premiumResponse } from "@/lib/entitlements/premium-boundary";
import { servePonsState } from "@/lib/ingestion/pons-live";
import { readPremiumDossier } from "@/db/premium-research";
import { parseResearchRequest } from "@/lib/premium/research";

export async function GET(request: Request) {
  let query: ReturnType<typeof parseResearchRequest>;
  try { query = parseResearchRequest(new URL(request.url)); } catch {
    return Response.json({ error: "invalid_research_query" }, { status: 400, headers: { "cache-control": "private, no-store" } });
  }
  const bindings = env as unknown as Record<string, unknown>;
  return premiumResponse({
    authenticate: () => authenticateMember({ request, db: env.DB, bindings, forceIdentitySync: true }),
    evaluate: (userId) => evaluatePremiumAccess({ db: env.DB, userId, bindings }),
    load: async () => {
      const state = await servePonsState(undefined, query.token);
      return { dossier: await readPremiumDossier(state, query) };
    },
  });
}
