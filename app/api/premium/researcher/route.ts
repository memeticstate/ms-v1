import { env } from "cloudflare:workers";
import { ResearchStore } from "@/db/researcher";
import { authenticateMember } from "@/lib/auth/server";
import { evaluatePremiumAccess } from "@/lib/entitlements/token-gate";
import { researcherResponse } from "@/lib/researcher/http";
import { researchModelConfig } from "@/lib/researcher/agent";

export async function GET(request: Request) {
  const bindings = env as unknown as Record<string, unknown>;
  return researcherResponse(request, { store: new ResearchStore(env.DB), configured: Boolean(researchModelConfig(bindings)),
    authenticate: () => authenticateMember({ request, db: env.DB, bindings, forceIdentitySync: true }),
    evaluate: userId => evaluatePremiumAccess({ db: env.DB, userId, bindings }),
  });
}
export const POST = GET;
export const PATCH = GET;
export const DELETE = GET;
