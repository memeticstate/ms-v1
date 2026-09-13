export const MEMETIC_PRIVY_APP_ID = "cmtp72a3700070bl79bfbeliw";
export const ROBINHOOD_CHAIN_ID = 4663;

export type MemeticAuthProvider = "chatgpt" | "privy";

export class AuthRequestError extends Error {
  constructor(
    public readonly code: string,
    public readonly status: number,
  ) {
    super(code);
    this.name = "AuthRequestError";
  }
}

function bindingString(bindings: Record<string, unknown>, key: string) {
  const value = bindings[key];
  return typeof value === "string" ? value.trim() : "";
}

export function authProviderFromBindings(
  bindings: Record<string, unknown> = {},
): MemeticAuthProvider {
  const configured = bindingString(bindings, "MEMETIC_AUTH_MODE").toLowerCase();
  if (!configured || configured === "chatgpt") return "chatgpt";
  if (configured === "privy") return "privy";
  throw new AuthRequestError("auth_mode_invalid", 503);
}

export function privyServerConfig(bindings: Record<string, unknown>) {
  const appId = bindingString(bindings, "PRIVY_APP_ID")
    || bindingString(bindings, "NEXT_PUBLIC_PRIVY_APP_ID")
    || MEMETIC_PRIVY_APP_ID;
  const appSecret = bindingString(bindings, "PRIVY_APP_SECRET");
  const jwtVerificationKey = bindingString(bindings, "PRIVY_JWT_VERIFICATION_KEY") || undefined;

  if (!appId || !appSecret) {
    throw new AuthRequestError("privy_configuration_required", 503);
  }

  return { appId, appSecret, jwtVerificationKey };
}

export function extractBearerToken(request: Request): string | null {
  const authorization = request.headers.get("authorization");
  if (!authorization) return null;
  const match = /^Bearer\s+([^\s]+)$/i.exec(authorization.trim());
  if (!match || match[1].length > 8_192) {
    throw new AuthRequestError("invalid_access_token", 401);
  }
  return match[1];
}

export function authErrorResponse(error: unknown) {
  if (error instanceof AuthRequestError) {
    return Response.json({ error: error.code }, {
      status: error.status,
      headers: { "cache-control": "no-store" },
    });
  }
  return Response.json({ error: "authentication_unavailable" }, {
    status: 503,
    headers: { "cache-control": "no-store" },
  });
}

export function adminIdentityAllowlist(bindings: Record<string, unknown>) {
  return new Set(bindingString(bindings, "MEMETIC_ADMIN_IDENTITIES")
    .split(",")
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean));
}
