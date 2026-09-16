"use client";

import { useEffect, useRef, useState } from "react";
import { safeTokenImage, tokenAddress, tokenText, type TokenIdentity } from "@/lib/tokens/model";
import { resolveTokenIcon } from "@/lib/tokens/icon-client";

export function TokenAvatar({ token, className = "", tone }: { token: TokenIdentity; className?: string; tone?: string }) {
  const address = tokenAddress(token.tokenAddress);
  const supplied = safeTokenImage(token.imageUrl);
  const [recovered, setRecovered] = useState<{ address: string; source: string | null } | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const element = useRef<HTMLSpanElement>(null);
  const source = supplied && supplied !== failed ? supplied : recovered?.address === address ? recovered.source : null;
  useEffect(() => {
    if (!address || (supplied && supplied !== failed)) return;
    let cancelled = false;
    let started = false;
    const load = () => {
      if (started) return; started = true;
      void resolveTokenIcon(address).then(source => { if (!cancelled) setRecovered({ address, source }); });
    };
    if (typeof IntersectionObserver === 'undefined') load();
    else {
      const observer = new IntersectionObserver(entries => {
        if (entries.some(entry => entry.isIntersecting)) { observer.disconnect(); load(); }
      }, { rootMargin: '160px' });
      if (element.current) observer.observe(element.current);
      return () => { cancelled = true; observer.disconnect(); };
    }
    return () => { cancelled = true; };
  }, [address, supplied, failed]);
  const initials = (tokenText(token.symbol) ?? tokenText(token.name))?.replace(/^\$/, "").slice(0, 2).toUpperCase() ?? token.tokenAddress.slice(2, 4).toUpperCase();
  return <span ref={element} aria-hidden="true" className={className} data-tone={tone}>
    {source && failed !== source ? <img key={source} src={`/api/token-image?src=${encodeURIComponent(source)}`} alt="" width={52} height={52} loading="lazy" decoding="async" referrerPolicy="no-referrer" onError={() => setFailed(source)} style={{ width: "100%", height: "100%", objectFit: "cover", borderRadius: "inherit" }} /> : initials}
  </span>;
}
