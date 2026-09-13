import { loadTokenDiscovery } from "@/lib/tokens/discovery";

export async function GET() {
  const headers = { "cache-control": "no-store" };
  try { return Response.json(await loadTokenDiscovery(), { headers }); }
  catch { return Response.json({ error: "Token discovery is temporarily unavailable." }, { status: 503, headers }); }
}
