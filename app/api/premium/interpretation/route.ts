import { env } from "cloudflare:workers";
import { authenticateMember } from "@/lib/auth/server";
import { evaluatePremiumAccess } from "@/lib/entitlements/token-gate";
import { premiumResponse } from "@/lib/entitlements/premium-boundary";
import { derivePremiumInterpretation } from "@/lib/interpretation/premium-brief";
import { servePonsState } from "@/lib/ingestion/pons-live";
import { PONS_STATE_WINDOWS } from "@/lib/pons/signals";

export async function GET(request: Request) {
  const bindings = env as unknown as Record<string, unknown>;
  const requested = Number(new URL(request.url).searchParams.get("window"));
  const windowBlocks = PONS_STATE_WINDOWS.includes(requested as typeof PONS_STATE_WINDOWS[number]) ? requested : undefined;
  return premiumResponse({
    authenticate: () => authenticateMember({ request, db: env.DB, bindings, forceIdentitySync: true }),
    evaluate: (userId) => evaluatePremiumAccess({ db: env.DB, userId, bindings }),
    load: async () => ({ interpretation: derivePremiumInterpretation(await servePonsState(windowBlocks)) }),
  });
}
