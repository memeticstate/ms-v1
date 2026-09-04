import { getEngineHealth } from "@/db/engine-ledger";
import { getRpcHealth } from "@/db/rpc-health";

export async function GET() {
  try {
    const [engine, rpc] = await Promise.all([getEngineHealth(), getRpcHealth()]);
    return Response.json({ engine, rpc }, {
      headers: { "cache-control": "public, max-age=20, stale-while-revalidate=60" },
    });
  } catch (error) {
    return Response.json({
      error: "engine health unavailable",
      detail: error instanceof Error ? error.message : "unknown",
    }, { status: 503, headers: { "cache-control": "no-store" } });
  }
}
