import { safeTokenImage } from "@/lib/tokens/model";

export async function GET(request: Request) {
  const source = safeTokenImage(new URL(request.url).searchParams.get("src"));
  if (!source) return new Response(null, { status: 400 });
  try {
    const response = await fetch(source, { redirect: "manual", signal: AbortSignal.timeout(12_000), headers: { accept: "image/avif,image/webp,image/png,image/jpeg,image/gif" } });
    const type = response.headers.get("content-type")?.split(";")[0] ?? "";
    if (!response.ok || !["image/png", "image/jpeg", "image/webp", "image/gif", "image/avif"].includes(type)) {
      await response.body?.cancel(); return new Response(null, { status: 404 });
    }
    const reader = response.body?.getReader();
    if (!reader) return new Response(null, { status: 404 });
    const parts: Uint8Array[] = []; let size = 0;
    try {
      while (true) { const { value, done } = await reader.read(); if (done) break;
        size += value.byteLength; if (size > 750_000) throw new Error("image_too_large"); parts.push(value);
      }
    } finally { await reader.cancel().catch(() => undefined); }
    const bytes = new Uint8Array(size); let offset = 0;
    for (const part of parts) { bytes.set(part, offset); offset += part.byteLength; }
    return new Response(bytes, { headers: { "content-type": type, "cache-control": "public, max-age=86400", "x-content-type-options": "nosniff" } });
  } catch { return new Response(null, { status: 502 }); }
}
