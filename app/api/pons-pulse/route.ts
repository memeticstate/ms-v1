import { getD1 } from "@/db";
import { getPulseEvidence } from "@/db/pons-pulse";
import { pulseLabels, type PulseMetricKey } from "@/lib/pons/pulse-evidence";

export async function GET(request: Request) {
  const headers = { "cache-control": "no-store" };
  const params = new URL(request.url).searchParams;
  const metric = params.get("metric") ?? "";
  const toBlock = Number(params.get("toBlock"));
  const offset = Number(params.get("offset") ?? 0);
  if (!Object.hasOwn(pulseLabels, metric) || !Number.isSafeInteger(toBlock) || toBlock <= 0
    || !Number.isSafeInteger(offset) || offset < 0 || offset > 100_000) {
    return Response.json({ error: "Invalid pulse interval." }, { status: 400, headers });
  }
  try {
    const index = await getD1().prepare("SELECT latest_safe_block FROM pons_index_state WHERE id = 'pons-v2'").first<{ latest_safe_block: number }>();
    if (toBlock > Number(index?.latest_safe_block ?? 0)) {
      return Response.json({ error: "This interval is no longer committed. Refresh the pulse to continue." }, { status: 409, headers });
    }
    return Response.json(await getPulseEvidence(metric as PulseMetricKey, toBlock, offset), { headers });
  } catch {
    return Response.json({ error: "Evidence is temporarily unavailable. Please retry." }, { status: 503, headers });
  }
}
