import { cachedTokenIdentities, loadDiscoveryCache, saveDiscoveryCache, searchIndexedTokens, searchDiscoveredTokens, storeDiscoveredIdentities } from "@/db/token-discovery";
import { acquireAuxJob, releaseAuxJob } from "@/db/pons-research";
import { fetchPonsDiscovery, searchPons } from "./pons-source";
import { tokenAddress, tokenText, type TokenDiscoveryResponse, type TokenSearchResponse, type TokenSearchResult } from "./model";
import { requestCache } from "@/lib/request-context";

async function shared<T>(key: string, work: () => Promise<T>): Promise<T> {
  const inFlight = requestCache("discovery", () => new Map<string, Promise<unknown>>());
  if (inFlight.has(key)) return inFlight.get(key) as Promise<T>;
  if (inFlight.size >= 64) throw new Error("discovery_busy");
  const task = work(); inFlight.set(key, task);
  try { return await task; } finally { inFlight.delete(key); }
}

export function rankTokenMatches(results: TokenSearchResult[], query: string) {
  const needle = query.toLowerCase().replace(/^\$/, "");
  const exact = tokenAddress(needle);
  const merged = new Map<string, TokenSearchResult>();
  for (const item of results) {
    if (exact && item.tokenAddress !== exact) continue;
    const previous = merged.get(item.tokenAddress);
    merged.set(item.tokenAddress, previous ? { ...previous, ...item,
      name: previous.source === "index" && previous.name ? previous.name : item.name ?? previous.name,
      symbol: previous.source === "index" && previous.symbol ? previous.symbol : item.symbol ?? previous.symbol,
      indexed: previous.indexed || item.indexed,
    } : item);
  }
  const score = (item: TokenSearchResult) => item.tokenAddress === exact ? 5
    : item.symbol?.toLowerCase() === needle ? 4 : item.name?.toLowerCase() === needle ? 3
      : item.symbol?.toLowerCase().startsWith(needle) || item.name?.toLowerCase().startsWith(needle) ? 2 : 1;
  return [...merged.values()].sort((a, b) => score(b) - score(a) || (b.volume24hUsd ?? 0) - (a.volume24hUsd ?? 0)
    || (b.marketCapUsd ?? 0) - (a.marketCapUsd ?? 0) || a.tokenAddress.localeCompare(b.tokenAddress)).slice(0, 20);
}

export async function searchTokens(input: string): Promise<TokenSearchResponse> {
  const query = tokenText(input, 96)?.replace(/^\$/, "") ?? "";
  if (query.length < 2) return { query, results: [], partial: false };
  const key = `search:${query.toLowerCase()}`;
  const cached = await loadDiscoveryCache<TokenSearchResponse>(key);
  if (cached && cached.expiresAt > Date.now()) return cached.value;
  return shared(key, async () => {
    const exact = tokenAddress(query);
    const contractIdentity = async (): Promise<TokenSearchResult | null> => {
      if (!exact) return null;
      const cachedIdentity = await loadDiscoveryCache<TokenSearchResult>(`token:${exact}`);
      if (cachedIdentity) return { ...cachedIdentity.value, sourceStale: cachedIdentity.expiresAt < Date.now() };
      const { readPonsTokenMetadata } = await import("@/lib/ingestion/pons-rpc");
      const { records } = await readPonsTokenMetadata([{ tokenAddress: exact }]);
      const record = records[0];
      return record?.name || record?.symbol ? { tokenAddress: exact, name: tokenText(record.name), symbol: tokenText(record.symbol), source: "contract", indexed: false } : null;
    };
    // Exact contract reads run alongside the catalog, so an unavailable catalog
    // cannot add a second timeout before an ERC-20 identity is returned.
    const [local, remote, contract, discovered] = await Promise.allSettled([searchIndexedTokens(query), searchPons(query), contractIdentity(), searchDiscoveredTokens(query)]);
    let items = local.status === "fulfilled" ? local.value : [];
    const identities = await cachedTokenIdentities(items.map(item => item.tokenAddress));
    items = items.map(item => ({ ...identities.get(item.tokenAddress), ...item,
      name: item.name ?? identities.get(item.tokenAddress)?.name ?? null,
      symbol: item.symbol ?? identities.get(item.tokenAddress)?.symbol ?? null,
    }));
    if (discovered.status === "fulfilled") items.push(...discovered.value);
    if (remote.status === "fulfilled") {
      await storeDiscoveredIdentities(remote.value.slice(0, 24));
      items.push(...remote.value);
    }
    if (contract.status === "fulfilled" && contract.value) {
      const identity = contract.value;
      if (!items.some(item => item.tokenAddress === exact)) items.push(identity);
      else items = items.map(item => item.tokenAddress === exact ? { ...item, name: item.name ?? identity.name, symbol: item.symbol ?? identity.symbol, imageUrl: item.imageUrl ?? identity.imageUrl } : item);
      await storeDiscoveredIdentities(items.filter(item => item.tokenAddress === exact));
    }
    const results = rankTokenMatches(items, query);
    const partial = local.status === "rejected" || remote.status === "rejected" || discovered.status === "rejected";
    const response = { query, results, partial };
    await saveDiscoveryCache(key, response, partial ? 10_000 : 30_000);
    return response;
  });
}

type DiscoveryOptions = { background?: (task: Promise<unknown>) => void };

async function discoveryLane(kind: "markets" | "launches", options: DiscoveryOptions = {}) {
  const key = `radar:${kind}`;
  const cached = await loadDiscoveryCache<TokenSearchResult[]>(key);
  if (cached && cached.expiresAt > Date.now()) return { items: cached.value, partial: false, fetchedAt: cached.fetchedAt };
  return shared(key, async () => {
    // Share refresh cadence across Worker isolates and all visitors.
    const lease = `discovery-${kind}`;
    if (!await acquireAuxJob(lease, 20_000)) return { items: cached?.value ?? [], partial: !cached || Date.now() - cached.fetchedAt > 120_000, fetchedAt: cached?.fetchedAt ?? 0 };
    try {
      const tokens = await fetchPonsDiscovery(kind);
      const now = Date.now();
      const items = (kind === "markets" ? tokens.filter(item => item.latestBuyAt && now - Date.parse(item.latestBuyAt) < 24 * 60 * 60_000)
        .sort((a, b) => (b.marketCapUsd ?? 0) - (a.marketCapUsd ?? 0))
        : tokens.sort((a, b) => Date.parse(b.launchedAt ?? "") - Date.parse(a.launchedAt ?? ""))).slice(0, 40);
      // Make the complete radar available before the slower identity enrichment
      // batch, so another visitor doesn't see an empty cache during a cold start.
      await saveDiscoveryCache(key, items, 30_000);
      const enrich = storeDiscoveredIdentities(items).catch(() => console.error("token identity cache enrichment unavailable"));
      if (options.background) options.background(enrich); else await enrich;
      return { items, partial: false, fetchedAt: now };
    } catch (error) {
      console.error("token discovery source unavailable", { kind, reason: error instanceof Error ? error.message.slice(0, 160) : "unknown" });
      return { items: cached?.value ?? [], partial: true, fetchedAt: cached?.fetchedAt ?? 0 };
    } finally { await releaseAuxJob(lease); }
  });
}

export async function loadCachedTokenDiscovery(): Promise<TokenDiscoveryResponse | null> {
  const [markets, launches] = await Promise.all([
    loadDiscoveryCache<TokenSearchResult[]>("radar:markets"),
    loadDiscoveryCache<TokenSearchResult[]>("radar:launches"),
  ]);
  if (!markets && !launches) return null;
  return { markets: markets?.value ?? [], launches: launches?.value ?? [],
    fetchedAt: new Date(Math.max(markets?.fetchedAt ?? 0, launches?.fetchedAt ?? 0)).toISOString(),
    partial: !markets || !launches || Date.now() - Math.min(markets.fetchedAt, launches.fetchedAt) > 120_000 };
}

export async function loadTokenDiscovery(options: DiscoveryOptions = {}): Promise<TokenDiscoveryResponse> {
  const [markets, launches] = await Promise.all([discoveryLane("markets", options), discoveryLane("launches", options)]);
  return { markets: markets.items, launches: launches.items,
    fetchedAt: new Date(Math.max(markets.fetchedAt, launches.fetchedAt)).toISOString(), partial: markets.partial || launches.partial };
}

export async function lookupToken(address: string) {
  const exact = tokenAddress(address);
  if (!exact) return null;
  const cached = await loadDiscoveryCache<TokenSearchResult>(`token:${exact}`);
  if (cached && cached.expiresAt > Date.now()) return cached.value;
  const result = await searchTokens(exact);
  return result.results.find(item => item.tokenAddress === exact) ?? null;
}
