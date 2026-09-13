"use client";

import { useState } from "react";
import { safeTokenImage, tokenText, type TokenIdentity } from "@/lib/tokens/model";

export function TokenAvatar({ token, className = "", tone }: { token: TokenIdentity; className?: string; tone?: string }) {
  const source = safeTokenImage(token.imageUrl);
  const [failed, setFailed] = useState<string | null>(null);
  const initials = (tokenText(token.symbol) ?? tokenText(token.name))?.replace(/^\$/, "").slice(0, 2).toUpperCase() ?? token.tokenAddress.slice(2, 4).toUpperCase();
  return <span aria-hidden="true" className={className} data-tone={tone}>
    {source && failed !== source ? <img src={`/api/token-image?src=${encodeURIComponent(source)}`} alt="" width={52} height={52} loading="lazy" decoding="async" referrerPolicy="no-referrer" onError={() => setFailed(source)} style={{ width: "100%", height: "100%", objectFit: "cover", borderRadius: "inherit" }} /> : initials}
  </span>;
}
