import { serveAffinitySnapshot } from "@/lib/ingestion/pair-live";

export async function GET() {
  const envelope = await serveAffinitySnapshot();
  return Response.json(envelope, {
    headers: {
      "cache-control": "public, max-age=30, stale-while-revalidate=300",
      "content-type": "application/json; charset=utf-8",
    },
  });
}
