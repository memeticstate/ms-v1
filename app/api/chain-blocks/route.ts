import { NextResponse } from "next/server";

import { listChainBlocks } from "@/db/chain-block-ledger";

export const runtime = "edge";

export async function GET(request: Request) {
  const limit = Number(new URL(request.url).searchParams.get("limit") ?? "24");
  try {
    return NextResponse.json({ blocks: await listChainBlocks(limit) });
  } catch {
    return NextResponse.json({ blocks: [], error: "chain block ledger unavailable" }, { status: 503 });
  }
}
