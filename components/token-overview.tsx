"use client";

import { robinhoodExplorer } from "@/lib/robinhood-explorer";

import { useEffect, useState } from "react";
import { TokenAvatar } from "./token-avatar";
import { tokenTitle, tokenSubtitle, type TokenSearchResult } from "@/lib/tokens/model";
import { usd } from "@/lib/tokens/radar";

export function TokenOverview({ address, indexed, onIdentity }: {
  address: string; indexed: boolean; onIdentity?: (token: TokenSearchResult) => void;
}) {
  const [token, setToken] = useState<TokenSearchResult | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 18_000);
    void fetch(`/api/token-lookup?token=${encodeURIComponent(address)}`, { signal: controller.signal })
      .then(async response => { if (!response.ok) throw new Error("lookup_unavailable"); return response.json() as Promise<{ token: TokenSearchResult | null }>; })
      .then(result => { if (active) { setToken(result.token); setStatus("ready"); if (result.token) onIdentity?.(result.token); } })
      .catch(() => { if (active) setStatus("error"); });
    return () => { active = false; window.clearTimeout(timeout); controller.abort(); };
  }, [address, onIdentity]);
  const identity = token ?? { tokenAddress: address, name: null, symbol: null };
  return <section className="rounded-lg border border-foreground/15 p-4 text-sm leading-6" aria-label="Token overview">
    <div className="flex items-center gap-3"><TokenAvatar token={identity} className="grid size-12 shrink-0 place-items-center overflow-hidden rounded bg-signal/20 font-semibold" /><div className="min-w-0"><h3 className="break-words text-xl font-bold">{tokenTitle(identity)}</h3><p className="text-muted-foreground">{tokenSubtitle(identity)}</p></div></div>
    <p className="mt-3 break-all font-mono text-xs">{address}</p>
    {token?.source === "pons" ? <><dl className="my-4 grid grid-cols-2 gap-3"><div><dt className="text-muted-foreground">Market cap · PONS</dt><dd className="text-lg font-semibold">{usd(token.marketCapUsd)}</dd></div><div><dt className="text-muted-foreground">24h volume · PONS</dt><dd className="text-lg font-semibold">{usd(token.volume24hUsd)}</dd></div></dl>
      {token.latestBuyAt ? <p>Latest buy reported by PONS: {new Date(token.latestBuyAt).toUTCString()}</p> : null}
      {token.sourceFetchedAt ? <p className="mt-1 text-xs text-muted-foreground">Snapshot retrieved: {new Date(token.sourceFetchedAt).toUTCString()}{token.sourceStale ? " · refresh unavailable" : ""}</p> : null}
      <p className="mt-2 text-muted-foreground">Market information is reported by PONS and is separate from the indexed research below.</p></> : null}
    {!indexed ? <p className="mt-3 text-muted-foreground" role="status">{status === "loading" ? "Looking up this exact contract…" : status === "error" ? "The token lookup couldn’t connect. You can inspect this address directly below." : token ? "This token is outside the current research window. Its identity is available; a complete Memetic reading is not yet available." : "No token identity was resolved for this address on Robinhood Chain."}</p> : null}
    <div className="mt-4 flex flex-wrap gap-4"><a className="underline underline-offset-4" href={robinhoodExplorer.address(address)} target="_blank" rel="noreferrer">View contract ↗</a>{token?.source === "pons" ? <a className="underline underline-offset-4" href={`https://www.ponsfamily.com/launchpad/${address}`} target="_blank" rel="noreferrer">Open token on PONS ↗</a> : null}</div>
  </section>;
}
