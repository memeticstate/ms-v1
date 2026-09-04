export async function POST() {
  return Response.json({ accepted: true, trigger: "request-watchdog", lane: "pons-v2" }, {
    status: 202,
    headers: { "cache-control": "no-store" },
  });
}
