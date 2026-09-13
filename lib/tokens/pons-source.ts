import { safeTokenImage, tokenAddress, tokenText, type TokenSearchResult } from "./model";

export const PONS_ORIGIN = "https://www.ponsfamily.com";
const finite = (value: unknown) => typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;
const date = (value: unknown) => typeof value === "string" && Number.isFinite(Date.parse(value)) ? new Date(value).toISOString() : null;

export function parsePonsToken(value: unknown, fetchedAt: string, stale = false): TokenSearchResult | null {
  if (!value || typeof value !== "object") return null;
  const item = value as Record<string, unknown>;
  const address = typeof item.token === "string" ? tokenAddress(item.token) : null;
  if (!address) return null;
  const quote = item.quoteAsset as { symbol?: unknown } | undefined;
  return {
    tokenAddress: address, name: tokenText(item.name), symbol: tokenText(item.symbol, 32),
    imageUrl: safeTokenImage(item.logo), source: "pons", indexed: false,
    marketCapUsd: finite(item.marketCapUsd), volume24hUsd: finite(item.volume24hUsd),
    latestBuyAt: date(item.latestBuyAt), launchedAt: date(item.launchedAt),
    graduated: item.graduated === true, pairSymbol: tokenText(quote?.symbol, 24),
    sourceFetchedAt: fetchedAt, sourceStale: stale,
  };
}

export async function fetchPonsJson(path: string, timeoutMs = 14_000) {
  const response = await fetch(`${PONS_ORIGIN}${path}`, {
    // Workers supports manual/follow, not redirect:"error". Reject non-2xx
    // responses below so redirects still cannot leave the approved source.
    headers: { accept: "application/json" }, signal: AbortSignal.timeout(timeoutMs), redirect: "manual",
  });
  if (!response.ok || !response.headers.get("content-type")?.includes("application/json")) {
    await response.body?.cancel();
    throw new Error(`pons_source_${response.status}`);
  }
  // Bound untrusted catalog bodies within the Worker's memory budget.
  const reader = response.body?.getReader();
  if (!reader) throw new Error("pons_source_empty");
  const parts: Uint8Array[] = []; let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 3_000_000) throw new Error("pons_source_too_large");
      parts.push(value);
    }
  } finally { await reader.cancel().catch(() => undefined); }
  const bytes = new Uint8Array(size); let offset = 0;
  for (const part of parts) { bytes.set(part, offset); offset += part.byteLength; }
  const body: unknown = JSON.parse(new TextDecoder().decode(bytes));
  return { body, fetchedAt: new Date().toISOString(), stale: response.headers.get("x-pons-explore-snapshot-stale") === "true" };
}

export function parsePonsItems(items: unknown, fetchedAt: string, stale = false) {
  if (!Array.isArray(items)) throw new Error("invalid_pons_catalog");
  return items.map(item => parsePonsToken(item, fetchedAt, stale)).filter((item): item is TokenSearchResult => Boolean(item));
}

export async function searchPons(query: string) {
  const params = new URLSearchParams({ q: query, sort: "volume", age: "all", page: "1" });
  const result = await fetchPonsJson(`/api/pons-launches/search?${params}`);
  const body = result.body as { items?: unknown };
  return parsePonsItems(body.items, result.fetchedAt, result.stale);
}

export async function fetchPonsDiscovery(kind: "markets" | "launches") {
  const path = kind === "markets" ? "/api/pons-launches/graduations?catalog=1&v=12"
    : `/api/pons-launches?${new URLSearchParams({ explore: "1", sort: "newest", age: "24h", page: "1", pageSize: "24", graduatedPage: "1", graduatedPageSize: "1", includeGraduated: "0", version: "all", v: "22" })}`;
  const result = await fetchPonsJson(path);
  const body = result.body as { active?: { items?: unknown }; generatedAt?: number };
  const stale = result.stale || typeof body.generatedAt === "number" && Date.now() - body.generatedAt > 120_000;
  return parsePonsItems(kind === "markets" ? result.body : body.active?.items, result.fetchedAt, stale);
}
