export type TokenIdentity = {
  tokenAddress: string;
  name: string | null;
  symbol: string | null;
  imageUrl?: string | null;
};

export type TokenSearchResult = TokenIdentity & {
  source: "pons" | "index" | "explorer" | "contract";
  indexed: boolean;
  marketCapUsd?: number | null;
  volume24hUsd?: number | null;
  latestBuyAt?: string | null;
  launchedAt?: string | null;
  graduated?: boolean;
  pairSymbol?: string | null;
  sourceFetchedAt?: string | null;
  sourceStale?: boolean;
};

export type TokenDiscoveryResponse = {
  markets: TokenSearchResult[];
  launches: TokenSearchResult[];
  fetchedAt: string;
  partial: boolean;
};

export type TokenSearchResponse = {
  query: string;
  results: TokenSearchResult[];
  partial: boolean;
};

export function tokenText(value: unknown, max = 96): string | null {
  if (typeof value !== "string") return null;
  const clean = value.replace(/[\u0000-\u001f\u007f\u200b-\u200f\u202a-\u202e\u2066-\u2069]/g, "").trim().slice(0, max);
  return !clean || /^(?:—|unnamed token|name unresolved|name not resolved yet)$/i.test(clean) ? null : clean;
}

export function tokenAddress(value: string): string | null {
  const clean = value.trim();
  return /^0x[0-9a-f]{40}$/i.test(clean) ? clean.toLowerCase() : null;
}

export function shortTokenAddress(value: string) { return `${value.slice(0, 6)}…${value.slice(-6)}`; }

export function tokenIdentityText(value: unknown, max = 96) {
  const text = tokenText(value, max);
  return text && !/^\$?0x[0-9a-f]{4,}(?:[.…]+[0-9a-f]+)?$/i.test(text) ? text : null;
}

export function tokenTitle(token: TokenIdentity) {
  const symbol = tokenIdentityText(token.symbol, 32);
  return symbol ? `$${symbol.replace(/^\$/, "")}` : tokenIdentityText(token.name) ?? "Token identity pending";
}

export function tokenSubtitle(token: TokenIdentity) {
  const name = tokenIdentityText(token.name);
  const symbol = tokenIdentityText(token.symbol);
  return name && symbol && name !== symbol ? name : "";
}

export function safeTokenImage(value: unknown): string | null {
  if (typeof value !== "string" || value.length > 600) return null;
  try {
    const ipfs = value.match(/^ipfs:\/\/(?:ipfs\/)?([a-zA-Z0-9]+)$/);
    if (ipfs) return `https://www.ponsfamily.com/api/ipfs/content/${ipfs[1]}?variant=card`;
    const url = new URL(value);
    if (url.username || url.password || url.port) return null;
    // Only token media hosted by the upstream launchpad is loaded automatically.
    if (url.protocol === "https:" && url.hostname === "www.ponsfamily.com" && /^\/api\/ipfs\/content\/[a-zA-Z0-9]+$/.test(url.pathname)) {
      return `${url.origin}${url.pathname}?variant=card`;
    }
    if (url.protocol === "https:" && (
      url.hostname === "img.koyen.fun" && /^\/[a-zA-Z0-9_-]+\.(?:png|jpe?g|webp|gif)$/i.test(url.pathname)
      || url.hostname === "metadata.j7tracker.io" && /^\/images\/[a-zA-Z0-9_-]+$/.test(url.pathname)
    )) return url.toString();
  } catch { /* Invalid or arbitrary remote URLs do not become image requests. */ }
  return null;
}
