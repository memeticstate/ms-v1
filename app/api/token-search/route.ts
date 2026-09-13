import { searchTokens } from "@/lib/tokens/discovery";

export async function GET(request: Request) {
  const query = new URL(request.url).searchParams.get("q") ?? "";
  const headers = { "cache-control": "no-store" };
  if (query.length > 96) return Response.json({ error: "Search is too long." }, { status: 400, headers });
  try { return Response.json(await searchTokens(query), { headers }); }
  catch { return Response.json({ query, results: [], partial: true, error: "Search is temporarily unavailable." }, { status: 503, headers }); }
}
