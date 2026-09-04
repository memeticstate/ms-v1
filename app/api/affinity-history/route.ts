import { listSnapshotHistory } from "@/db/snapshot-ledger";

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const limit = Number(url.searchParams.get("limit") ?? 24);
    const snapshots = await listSnapshotHistory(Number.isFinite(limit) ? limit : 24);
    return Response.json({ snapshots }, {
      headers: { "cache-control": "public, max-age=30, stale-while-revalidate=300" },
    });
  } catch {
    return Response.json({ snapshots: [], error: "history unavailable" }, { status: 503 });
  }
}
