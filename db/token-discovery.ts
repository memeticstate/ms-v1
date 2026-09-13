import { getD1 } from "@/db";
import { tokenAddress, tokenText, type TokenSearchResult } from "@/lib/tokens/model";

export async function loadDiscoveryCache<T>(key: string) {
  const row = await getD1().prepare("SELECT payload_json, fetched_at, expires_at FROM token_discovery_cache WHERE key = ?")
    .bind(key).first<{ payload_json: string; fetched_at: number; expires_at: number }>();
  if (!row) return null;
  try { return { value: JSON.parse(row.payload_json) as T, fetchedAt: row.fetched_at, expiresAt: row.expires_at }; }
  catch { return null; }
}

export async function saveDiscoveryCache(key: string, value: unknown, ttlMs: number) {
  const now = Date.now();
  await getD1().prepare(`INSERT INTO token_discovery_cache (key, payload_json, fetched_at, expires_at) VALUES (?, ?, ?, ?)
    ON CONFLICT(key) DO UPDATE SET payload_json = excluded.payload_json, fetched_at = excluded.fetched_at, expires_at = excluded.expires_at`)
    .bind(key, JSON.stringify(value), now, now + ttlMs).run();
}

export async function storeDiscoveredIdentities(items: TokenSearchResult[]) {
  const db = getD1(), now = Date.now();
  const unique = [...new Map(items.map(item => [item.tokenAddress, item])).values()].slice(0, 80);
  // Off-chain identity is cached separately. It never creates canonical launches or trades.
  for (let offset = 0; offset < unique.length; offset += 20) {
    await db.batch(unique.slice(offset, offset + 20).map(item => db.prepare(`INSERT INTO token_discovery_cache (key, payload_json, fetched_at, expires_at) VALUES (?, ?, ?, ?)
      ON CONFLICT(key) DO UPDATE SET payload_json = excluded.payload_json, fetched_at = excluded.fetched_at, expires_at = excluded.expires_at`)
      .bind(`token:${item.tokenAddress}`, JSON.stringify(item), now, now + 300_000)));
  }
}

export async function searchIndexedTokens(query: string): Promise<TokenSearchResult[]> {
  const exact = tokenAddress(query);
  const needle = query.toLowerCase().replace(/[\\%_]/g, "\\$&");
  const rows = await getD1().prepare(`SELECT token_address, token_name, token_symbol FROM (
    SELECT token_address, token_name, token_symbol, block_number FROM pons_launches
    WHERE ${exact ? "token_address = ?" : "(token_name LIKE ? ESCAPE '\\' OR token_symbol LIKE ? ESCAPE '\\' OR token_address LIKE ? ESCAPE '\\')"}
    UNION ALL
    SELECT token_address, token_name, token_symbol, block_number FROM pons_v1_launches
    WHERE ${exact ? "token_address = ?" : "(token_name LIKE ? ESCAPE '\\' OR token_symbol LIKE ? ESCAPE '\\' OR token_address LIKE ? ESCAPE '\\')"}
  ) ORDER BY block_number DESC LIMIT 24`)
    .bind(...(exact ? [exact, exact] : [0, 1].flatMap(() => [`%${needle}%`, `%${needle}%`, `${needle}%`])))
    .all<{ token_address: string; token_name: string | null; token_symbol: string | null }>();
  return [...new Map(rows.results.map(row => [row.token_address, {
    tokenAddress: row.token_address, name: tokenText(row.token_name), symbol: tokenText(row.token_symbol), source: "index" as const, indexed: true,
  }])).values()];
}

export async function searchDiscoveredTokens(query: string): Promise<TokenSearchResult[]> {
  const exact = tokenAddress(query);
  const needle = query.toLowerCase().replace(/[\\%_]/g, "\\$&");
  const rows = await getD1().prepare(`SELECT payload_json, expires_at FROM token_discovery_cache
    WHERE key LIKE 'token:%' AND json_valid(payload_json) AND ${exact ? "key = ?" : "(json_extract(payload_json, '$.name') LIKE ? ESCAPE '\\' OR json_extract(payload_json, '$.symbol') LIKE ? ESCAPE '\\')"}
    ORDER BY (LOWER(json_extract(payload_json, '$.symbol')) = ?) DESC, fetched_at DESC LIMIT 24`)
    .bind(...(exact ? [`token:${exact}`] : [`%${needle}%`, `%${needle}%`]), query.toLowerCase())
    .all<{ payload_json: string; expires_at: number }>();
  return rows.results.flatMap(row => {
    try {
      const item = JSON.parse(row.payload_json) as TokenSearchResult;
      return tokenAddress(item.tokenAddress) ? [{ ...item, sourceStale: item.sourceStale || row.expires_at < Date.now() }] : [];
    } catch { return []; }
  });
}

export async function cachedTokenIdentities(addresses: string[]) {
  if (!addresses.length) return new Map<string, TokenSearchResult>();
  const result = new Map<string, TokenSearchResult>();
  for (let offset = 0; offset < addresses.length; offset += 75) {
    const keys = addresses.slice(offset, offset + 75).map(address => `token:${address.toLowerCase()}`);
    const rows = await getD1().prepare(`SELECT payload_json FROM token_discovery_cache WHERE key IN (${keys.map(() => "?").join(",")})`)
      .bind(...keys).all<{ payload_json: string }>();
    for (const row of rows.results) {
      try { const item = JSON.parse(row.payload_json) as TokenSearchResult; result.set(item.tokenAddress, item); } catch { /* Ignore malformed cached identities. */ }
    }
  }
  return result;
}

export async function pruneDiscoveryCache() {
  // Identity caches may remain useful; expire query/snapshot debris in bounded batches.
  await getD1().prepare("DELETE FROM token_discovery_cache WHERE key IN (SELECT key FROM token_discovery_cache WHERE expires_at < ? ORDER BY expires_at LIMIT 200)")
    .bind(Date.now() - 7 * 24 * 60 * 60_000).run();
}
