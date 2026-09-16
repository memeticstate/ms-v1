"use client";

import { useEffect, useRef, useState } from "react";
import { Command, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { TokenAvatar } from "./token-avatar";
import { tokenAddress, tokenSubtitle, tokenTitle, type TokenSearchResponse, type TokenSearchResult } from "@/lib/tokens/model";
import styles from "./token-search.module.css";

export function TokenSearch({ onSelect, className = "", appearance = "app" }: {
  onSelect: (token: TokenSearchResult) => void; className?: string; appearance?: "landing" | "app";
}) {
  const [query, setQuery] = useState("");
  const [response, setResponse] = useState<TokenSearchResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const [open, setOpen] = useState(false);
  const [retry, setRetry] = useState(0);
  const root = useRef<HTMLDivElement>(null);
  const needle = query.trim();

  useEffect(() => {
    if (needle.length < 2) return;
    let active = true;
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 18_000);
    const timer = window.setTimeout(async () => {
      setLoading(true); setError(false);
      try {
        const result = await fetch(`/api/token-search?q=${encodeURIComponent(needle)}`, { signal: controller.signal });
        if (!result.ok) throw new Error("search_unavailable");
        const next = await result.json() as TokenSearchResponse;
        if (!Array.isArray(next.results)) throw new Error("invalid_search");
        if (active) setResponse(next);
      } catch {
        if (active) setError(true);
      } finally { if (active) setLoading(false); }
    }, 250);
    return () => { active = false; window.clearTimeout(timer); window.clearTimeout(timeout); controller.abort(); };
  }, [needle, retry]);

  useEffect(() => {
    const close = (event: PointerEvent) => { if (!root.current?.contains(event.target as Node)) setOpen(false); };
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, []);

  const choose = (token: TokenSearchResult) => { setOpen(false); setQuery(""); setResponse(null); setLoading(false); onSelect(token); };
  const results = response?.query.toLowerCase() === needle.replace(/^\$/, "").toLowerCase() ? response.results : [];
  const address = tokenAddress(needle);
  const visible = open && needle.length >= 2;
  return <div ref={root} className={`${styles.search} ${className}`} data-appearance={appearance}>
    <Command shouldFilter={false} className={styles.command} onKeyDown={event => { if (event.key === "Escape") { setOpen(false); event.stopPropagation(); } }}>
      <CommandInput value={query} onValueChange={value => { setQuery(value.slice(0, 96)); setOpen(true); setLoading(value.trim().length >= 2); setError(false); }}
        onFocus={() => setOpen(true)} aria-expanded={visible} aria-label="Search Robinhood Chain tokens by name, ticker, or contract address" placeholder="Search a token or paste a contract address" autoComplete="off" spellCheck={false} maxLength={96} />
      {visible ? <CommandList className={styles.results} aria-label="Token search results" aria-busy={loading}>
        <div className={styles.searchStatus} role="status">{loading ? "Searching tokens…" : error ? "Search couldn’t connect. Try again." : response?.partial ? "Some sources are unavailable. Available matches are shown." : `${results.length} matches · Robinhood Chain`}</div>
        {results.map(token => <CommandItem key={token.tokenAddress} value={token.tokenAddress} onSelect={() => choose(token)} className={styles.result}>
          <TokenAvatar token={token} className={styles.avatar} />
          <span className={styles.identity}><strong>{tokenTitle(token)}</strong><span>{tokenSubtitle(token)}</span></span>
          <span className={styles.source}>{token.indexed ? "Indexed" : token.source === "pons" ? "PONS" : "Contract"}</span>
        </CommandItem>)}
        {!loading && !error && !results.length ? <p className={styles.empty}>{response?.partial ? "No matches from the available sources. Retry or inspect a full contract address." : "No matching token was found. Try the full name or contract address."}</p> : null}
        {!loading && (error || response?.partial) ? <CommandItem value="retry-search" onSelect={() => { setLoading(true); setRetry(value => value + 1); }} className={styles.addressAction}>Retry search</CommandItem> : null}
        {address && !results.some(token => token.tokenAddress === address) ? <CommandItem value={`inspect-${address}`} onSelect={() => choose({ tokenAddress: address, name: null, symbol: null, indexed: false, source: "contract" })} className={styles.addressAction}>Inspect this contract</CommandItem> : null}
      </CommandList> : null}
    </Command>
  </div>;
}
