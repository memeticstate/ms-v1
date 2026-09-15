/** Public verification links only. RPC and collector API endpoints are independent. */
export const ROBINHOOD_EXPLORER = "https://robin.etherscan.io";

export const robinhoodExplorer = {
  address: (address: string) => `${ROBINHOOD_EXPLORER}/address/${encodeURIComponent(address)}`,
  tx: (hash: string) => `${ROBINHOOD_EXPLORER}/tx/${encodeURIComponent(hash)}`,
  block: (block: number | string) => `${ROBINHOOD_EXPLORER}/block/${encodeURIComponent(String(block))}`,
  token: (address: string) => `${ROBINHOOD_EXPLORER}/token/${encodeURIComponent(address)}`,
};

/** Update saved evidence links at display time without rewriting historical evidence or API URLs. */
export function canonicalRobinhoodExplorerUrl(value: string): string {
  try {
    const url = new URL(value);
    if (!["http:", "https:"].includes(url.protocol) || url.hostname !== "robinhoodchain.blockscout.com" || url.username || url.password || url.port) return value;
    const route = /^\/(address|tx|block|token)\/([^/]+)\/?$/.exec(url.pathname);
    if (!route) return value;
    const kind = route[1] as keyof typeof robinhoodExplorer;
    const base = robinhoodExplorer[kind](decodeURIComponent(route[2]));
    if (kind === "token" && url.searchParams.get("tab") === "holders") {
      url.searchParams.delete("tab");
      url.hash = "balances";
    }
    return `${base}${url.search}${url.hash}`;
  } catch {
    return value;
  }
}
