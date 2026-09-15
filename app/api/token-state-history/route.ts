import { loadPonsTokenStateHistory } from "@/db/pons-research";

export async function GET(request: Request) {
  const headers = { "cache-control": "no-store" };
  const token = new URL(request.url).searchParams.get("token") ?? "";
  if (!/^0x[0-9a-f]{40}$/i.test(token)) {
    return Response.json({ error: "A valid token contract is required." }, { status: 400, headers });
  }
  try {
    return Response.json(await loadPonsTokenStateHistory(token), { headers });
  } catch {
    return Response.json({ error: "Recorded state history is temporarily unavailable." }, { status: 503, headers });
  }
}
