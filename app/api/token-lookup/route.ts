import { lookupToken } from "@/lib/tokens/discovery";
import { tokenAddress } from "@/lib/tokens/model";

export async function GET(request: Request) {
  const address = tokenAddress(new URL(request.url).searchParams.get("token") ?? "");
  const headers = { "cache-control": "no-store" };
  if (!address) return Response.json({ error: "Invalid contract address." }, { status: 400, headers });
  try { return Response.json({ token: await lookupToken(address) }, { headers }); }
  catch { return Response.json({ token: null, error: "Token lookup is temporarily unavailable." }, { status: 503, headers }); }
}
