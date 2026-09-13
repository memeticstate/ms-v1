import { servePonsState } from "@/lib/ingestion/pons-live";

export async function GET(request: Request, background?: (task: Promise<unknown>) => void) {
  try {
    const url = new URL(request.url);
    const requestedWindow = Number(url.searchParams.get("window"));
    const windowBlocks = Number.isFinite(requestedWindow) && requestedWindow > 0 ? requestedWindow : undefined;
    return Response.json(await servePonsState(windowBlocks, url.searchParams.get("token") ?? undefined, {
      pair: url.searchParams.get("pair")?.slice(0, 32), phase: url.searchParams.get("phase") ?? undefined,
    }, typeof background === "function" ? background : undefined), {
      headers: { "cache-control": "no-store" },
    });
  } catch (error) {
    return Response.json({
      error: "PONS state unavailable",
      detail: error instanceof Error ? error.message : "unknown",
    }, { status: 503, headers: { "cache-control": "no-store" } });
  }
}
