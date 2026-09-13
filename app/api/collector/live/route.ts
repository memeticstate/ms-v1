// The Worker executes collection and reports the settled result.
export async function POST() {
  return Response.json({ accepted: false, error: "collector_worker_unavailable" }, { status: 503 });
}
