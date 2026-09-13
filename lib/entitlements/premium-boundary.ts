import { authErrorResponse } from "@/lib/auth/config";
import type { PremiumAccessEvaluation } from "./token-gate";

const PRIVATE_HEADERS = { "cache-control": "private, no-store", vary: "Authorization, Cookie" };

export class PremiumRequestError extends Error {
  constructor(public status: number, public code: string) { super(code); }
}

/** The data loader is never called until identity and holder access both pass. */
export async function premiumResponse<T extends Record<string, unknown>>(services: {
  authenticate: () => Promise<{ id: string } | null>;
  evaluate: (userId: string) => Promise<PremiumAccessEvaluation>;
  load: (user: { id: string }) => Promise<T>;
}) {
  let user;
  try { user = await services.authenticate(); } catch (error) { return authErrorResponse(error); }
  if (!user) return Response.json({ error: "sign_in_required" }, { status: 401, headers: PRIVATE_HEADERS });
  let gate;
  try { gate = await services.evaluate(user.id); } catch {
    return Response.json({ error: "holder_check_unavailable" }, { status: 503, headers: PRIVATE_HEADERS });
  }
  if (!gate.access.active || !gate.access.expiresAt || !Number.isFinite(Date.parse(gate.access.expiresAt)) || Date.parse(gate.access.expiresAt) <= Date.now()) {
    return Response.json({ error: "premium_access_required", premiumAccess: gate.access, tokenAdapter: gate.adapter }, { status: 403, headers: PRIVATE_HEADERS });
  }
  try {
    const data = await services.load(user);
    // A slow query cannot carry a result beyond the checked access window.
    if (Date.parse(gate.access.expiresAt) <= Date.now()) return Response.json({ error: "premium_access_required" }, { status: 403, headers: PRIVATE_HEADERS });
    return Response.json({ premiumAccess: gate.access, ...data }, { headers: PRIVATE_HEADERS });
  } catch (error) {
    if (error instanceof PremiumRequestError) return Response.json({ error: error.code }, { status: error.status, headers: PRIVATE_HEADERS });
    return Response.json({ error: "research_unavailable" }, { status: 503, headers: PRIVATE_HEADERS });
  }
}
