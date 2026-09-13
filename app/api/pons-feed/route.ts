import { loadFactoryFeed } from "@/db/pons-factory";
export async function GET() {
  const headers = { "cache-control": "no-store" };
  try { return Response.json({ feed: await loadFactoryFeed() }, { headers }); }
  catch { return Response.json({ error: "Factory feed temporarily unavailable" }, { status: 503, headers }); }
}
