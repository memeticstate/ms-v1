import { servePonsState } from "@/lib/ingestion/pons-live";

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const requestedWindow = Number(url.searchParams.get("window"));
    const windowBlocks = Number.isFinite(requestedWindow) && requestedWindow > 0 ? requestedWindow : undefined;
    return Response.json(await servePonsState(windowBlocks), {
      headers: { "cache-control": "public, max-age=15, stale-while-revalidate=45" },
    });
  } catch (error) {
    return Response.json({
      error: "PONS state unavailable",
      detail: error instanceof Error ? error.message : "unknown",
    }, { status: 503, headers: { "cache-control": "no-store" } });
  }
}
