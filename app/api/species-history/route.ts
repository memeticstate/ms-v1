import { NextResponse } from "next/server";

import { listSpeciesHistory } from "@/db/species-history";

export const runtime = "edge";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const speciesId = url.searchParams.get("speciesId")?.trim();
  const limit = Number(url.searchParams.get("limit") ?? "72");
  if (!speciesId || speciesId.length > 64) {
    return NextResponse.json({ history: [], error: "valid speciesId required" }, { status: 400 });
  }
  try {
    return NextResponse.json({ history: await listSpeciesHistory(speciesId, limit) });
  } catch {
    return NextResponse.json({ history: [], error: "species history unavailable" }, { status: 503 });
  }
}
