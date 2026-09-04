export async function POST(request: Request) {
  const url = new URL(request.url);
  const generation = url.searchParams.get("generation") === "v1-legacy" ? "v1-legacy" : "v1-current";
  return Response.json({
    accepted: true,
    trigger: "request-watchdog",
    lane: `pons-${generation}`,
    generation,
  }, {
    status: 202,
    headers: { "cache-control": "no-store" },
  });
}
