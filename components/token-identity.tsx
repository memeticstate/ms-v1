"use client";

import { useEffect, useRef, useState } from "react";
import { Check, Copy } from "lucide-react";
import { resolveTokenIdentity } from "@/lib/tokens/icon-client";
import { safeTokenImage, tokenAddress, tokenIdentityText, tokenSubtitle, tokenTitle, type TokenIdentity } from "@/lib/tokens/model";

export function useResolvedToken(token: TokenIdentity, needsImage = false) {
  const address = tokenAddress(token.tokenAddress);
  const name = tokenIdentityText(token.name), symbol = tokenIdentityText(token.symbol, 32);
  const imageUrl = safeTokenImage(token.imageUrl);
  const element = useRef<HTMLSpanElement>(null);
  const [result, setResult] = useState<{ address: string; identity: TokenIdentity | null } | null>(null);
  useEffect(() => {
    if (!address || (symbol && name && (!needsImage || imageUrl))) return;
    let cancelled = false, visible = false, loading = false;
    const load = async () => {
      if (cancelled || loading || !visible || document.visibilityState === "hidden") return;
      loading = true;
      const identity = await resolveTokenIdentity(address);
      loading = false;
      if (!cancelled) setResult({ address, identity });
    };
    const observer = typeof IntersectionObserver === "undefined" ? null : new IntersectionObserver(entries => {
      visible = entries.some(entry => entry.isIntersecting);
      if (visible) void load();
    }, { rootMargin: "160px" });
    if (observer && element.current) observer.observe(element.current);
    else { visible = true; void load(); }
    const timer = window.setInterval(() => void load(), 65_000);
    return () => { cancelled = true; observer?.disconnect(); window.clearInterval(timer); };
  }, [address, name, symbol, imageUrl, needsImage]);
  const recovered = result?.address === address ? result.identity : null;
  const identity: TokenIdentity = { tokenAddress: token.tokenAddress,
    name: name ?? tokenIdentityText(recovered?.name), symbol: symbol ?? tokenIdentityText(recovered?.symbol),
    imageUrl: imageUrl ?? recovered?.imageUrl };
  return { element, identity };
}

export function TokenLabel({ token, showName = true, className = "" }: { token: TokenIdentity; showName?: boolean; className?: string }) {
  const { element, identity } = useResolvedToken(token);
  return <span ref={element} className={`min-w-0 ${className}`}>
    <strong className="block truncate">{tokenTitle(identity)}</strong>
    {showName && tokenSubtitle(identity) ? <span className="block truncate text-xs font-normal text-muted-foreground">{tokenSubtitle(identity)}</span> : null}
  </span>;
}

export function CopyContract({ address, className = "" }: { address: string; className?: string }) {
  const [status, setStatus] = useState<"idle" | "copied" | "failed">("idle");
  useEffect(() => { setStatus("idle"); }, [address]);
  useEffect(() => {
    if (status === "idle") return;
    const timer = window.setTimeout(() => setStatus("idle"), 3000);
    return () => window.clearTimeout(timer);
  }, [status]);
  return <span className={`relative z-20 inline-flex shrink-0 ${className}`}>
    <button type="button" aria-label={status === "copied" ? "Contract address copied" : "Copy contract address"}
      onClick={async event => {
        event.preventDefault(); event.stopPropagation();
        try { await navigator.clipboard.writeText(address); setStatus("copied"); }
        catch { setStatus("failed"); }
      }} onKeyDown={event => event.stopPropagation()}
      className="inline-flex min-h-9 items-center gap-1.5 rounded-lg border border-foreground/15 px-2 text-xs text-muted-foreground hover:text-foreground focus-visible:outline-2 focus-visible:outline-signal">
      {status === "copied" ? <Check size={13} /> : <Copy size={13} />}<span>{status === "copied" ? "Copied" : "Copy CA"}</span>
    </button>
    <span role="status" className="sr-only">{status === "copied" ? "Contract address copied" : status === "failed" ? "Copy failed. Please try again." : ""}</span>
  </span>;
}
