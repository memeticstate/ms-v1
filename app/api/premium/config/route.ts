import { env } from "cloudflare:workers";
import { tokenAdapterStatus, PREMIUM_HOLDER_THRESHOLD_BPS, TOKEN_GATE_CACHE_SECONDS } from "@/lib/entitlements/token-adapter";
import { readSupplyReference } from "@/lib/entitlements/supply-reference";

export async function GET() {
  const adapter = tokenAdapterStatus(env as unknown as Record<string, unknown>);
  try {
    const reference = adapter.contractAddress ? await readSupplyReference(env.DB, adapter.contractAddress) : null;
    return Response.json({ adapter, accessCacheSeconds: TOKEN_GATE_CACHE_SECONDS,
      reference: reference ? { supplyRaw: reference.supply_raw, decimals: reference.decimals, blockNumber: reference.block_number,
        recordedAt: new Date(reference.recorded_at * 1_000).toISOString(),
        requiredBalanceRaw: ((BigInt(reference.supply_raw) * BigInt(PREMIUM_HOLDER_THRESHOLD_BPS) + 9_999n) / 10_000n).toString() } : null,
    }, { headers: { "cache-control": "no-store" } });
  } catch {
    return Response.json({ error: "access_configuration_unavailable" }, { status: 503, headers: { "cache-control": "no-store" } });
  }
}
