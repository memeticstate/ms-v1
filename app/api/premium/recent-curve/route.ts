import { env } from "cloudflare:workers";
import { authenticateMember } from "@/lib/auth/server";
import { evaluatePremiumAccess } from "@/lib/entitlements/token-gate";
import { premiumResponse, PremiumRequestError } from "@/lib/entitlements/premium-boundary";
import { rejectCrossSiteMutation } from "@/lib/entitlements/request-security";
import { loadRecentCurveCheck, refreshRecentCurveCheck } from "@/db/premium-recent-curve";

function route(request: Request, refresh: boolean) {
  const bindings = env as unknown as Record<string, unknown>;
  return premiumResponse({
    authenticate: () => authenticateMember({ request, db: env.DB, bindings, forceIdentitySync: true }),
    evaluate: userId => evaluatePremiumAccess({ db: env.DB, userId, bindings }),
    load: async () => {
      const token = (new URL(request.url).searchParams.get("token") ?? "").toLowerCase();
      if (!/^0x[0-9a-f]{40}$/.test(token)) throw new PremiumRequestError(400, "invalid_token");
      return { recentCurve: await (refresh ? refreshRecentCurveCheck(token) : loadRecentCurveCheck(token)) };
    },
  });
}
export function GET(request: Request) { return route(request, false); }
export function POST(request: Request) { return rejectCrossSiteMutation(request) ?? route(request, true); }
