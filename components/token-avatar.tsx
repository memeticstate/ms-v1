"use client";

import { useState } from "react";
import { tokenIdentityText, type TokenIdentity } from "@/lib/tokens/model";
import { useResolvedToken } from "./token-identity";

export function TokenAvatar({ token, className = "", tone }: { token: TokenIdentity; className?: string; tone?: string }) {
  const [failed, setFailed] = useState<string | null>(null);
  const { element, identity } = useResolvedToken({ ...token, imageUrl: token.imageUrl === failed ? null : token.imageUrl }, true);
  const source = identity.imageUrl;
  const initials = (tokenIdentityText(identity.symbol) ?? tokenIdentityText(identity.name))?.replace(/^\$/, "").slice(0, 2).toUpperCase() ?? "?";
  return <span ref={element} aria-hidden="true" className={className} data-tone={tone}>
    {source && failed !== source ? <img key={source} src={`/api/token-image?src=${encodeURIComponent(source)}`} alt="" width={52} height={52} loading="lazy" decoding="async" referrerPolicy="no-referrer" onError={() => setFailed(source)} style={{ width: "100%", height: "100%", objectFit: "cover", borderRadius: "inherit" }} /> : initials}
  </span>;
}
