import { env } from "cloudflare:workers";

import { getChatGPTUser } from "@/app/chatgpt-auth";
import { evaluatePremiumAccess } from "@/lib/entitlements/token-gate";
import { derivePremiumInterpretation } from "@/lib/interpretation/premium-brief";
import { servePonsState } from "@/lib/ingestion/pons-live";

export async function GET(request: Request) {
  const user = await getChatGPTUser();
  if (!user) {
    return Response.json({ error: "sign_in_required" }, { status: 401, headers: { "cache-control": "no-store" } });
  }
  const url = new URL(request.url);
  const requestedWindow = Number(url.searchParams.get("window"));
  const windowBlocks = Number.isFinite(requestedWindow) && requestedWindow > 0 ? requestedWindow : undefined;
  let gate: Awaited<ReturnType<typeof evaluatePremiumAccess>>;
  try {
    gate = await evaluatePremiumAccess({
      db: env.DB,
      userId: user.id,
      bindings: env as unknown as Record<string, unknown>,
    });
  } catch {
    return Response.json({ error: "holder_check_unavailable" }, {
      status: 503,
      headers: { "cache-control": "no-store" },
    });
  }
  if (!gate.access.active) {
    return Response.json({ error: "premium_access_required", premiumAccess: gate.access, tokenAdapter: gate.adapter }, {
      status: 403,
      headers: { "cache-control": "no-store" },
    });
  }
  try {
    const state = await servePonsState(windowBlocks);
    return Response.json({ premiumAccess: gate.access, interpretation: derivePremiumInterpretation(state) }, {
      headers: { "cache-control": "private, no-store" },
    });
  } catch {
    return Response.json({ error: "interpretation_unavailable", premiumAccess: gate.access }, {
      status: 503,
      headers: { "cache-control": "no-store" },
    });
  }
}
