import { loadRecentPonsStateChanges } from "@/db/pons-research";

export async function GET(request: Request) {
  const headers = { "cache-control": "no-store" };
  const raw = new URL(request.url).searchParams.get("tokens");
  const tokens = raw === null ? undefined : raw.split(",").map((token) => token.trim());
  if (tokens && (tokens.length > 50 || tokens.some((token) => !/^0x[0-9a-f]{40}$/i.test(token)))) {
    return Response.json({ error: "Supply at most 50 valid token contracts." }, { status: 400, headers });
  }
  try {
    return Response.json(await loadRecentPonsStateChanges(tokens), { headers });
  } catch {
    return Response.json({ error: "Recorded state changes are temporarily unavailable." }, { status: 503, headers });
  }
}
