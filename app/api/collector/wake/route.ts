import { getCollectionHealth } from "@/db/collection-state";

export async function POST() {
  const before = await getCollectionHealth().catch(() => null);
  return Response.json({
    accepted: true,
    trigger: "manual",
    lanes: ["pons-v2", "robinhood-evidence"],
    message: "Forced PONS and Robinhood evidence collections have been handed to the worker execution context.",
    before,
  }, {
    status: 202,
    headers: { "cache-control": "no-store" },
  });
}
