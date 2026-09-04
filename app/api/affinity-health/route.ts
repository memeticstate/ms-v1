import { getCollectionHealth } from "@/db/collection-state";
import { getEngineHealth } from "@/db/engine-ledger";
import { getRpcHealth } from "@/db/rpc-health";

export async function GET() {
  try {
    const [health, collection, engine] = await Promise.all([getRpcHealth(), getCollectionHealth(), getEngineHealth()]);
    return Response.json({ ...health, collection, engine }, {
      headers: { "cache-control": "public, max-age=30, stale-while-revalidate=120" },
    });
  } catch {
    return Response.json({ providers: [], error: "health history unavailable" }, { status: 503 });
  }
}
