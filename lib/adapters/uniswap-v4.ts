import type { AdapterResult, Species } from "@/lib/affinity-model";

export type DirectPoolPayload = {
  poolId: string;
  communityToken: {
    address: string;
    symbol: string;
    name: string;
  };
  stockTokenSymbol: string;
  marketCapUsd: number;
  liquidityUsd: number;
  volume24hUsd: number;
  priceChange24h: number;
};

/**
 * Normalizes an ordinary community-token / Stock-Token V4 pool.
 * Unlike PAIR, direct pools have no declared multipool allocation. Their
 * affinity strength is inferred from observed liquidity and volume instead.
 */
export function normalizeDirectPool(
  pool: DirectPoolPayload,
  presentation: Pick<
    Species,
    "id" | "thesis" | "interpretation" | "coherence" | "vitality" | "stress" | "color" | "x" | "y"
  >,
): AdapterResult {
  const activity = pool.liquidityUsd + pool.volume24hUsd;
  const strength = Math.max(8, Math.min(100, Math.log10(Math.max(activity, 10)) * 17));

  return {
    species: {
      ...presentation,
      symbol: pool.communityToken.symbol,
      name: pool.communityToken.name,
      sourceProtocol: "uniswap-v4",
      sourceLabel: "UNISWAP V4",
      contract: pool.communityToken.address,
      marketCapUsd: pool.marketCapUsd,
      observedVolumeUsd: pool.volume24hUsd,
      change24h: pool.priceChange24h,
      graduated: false,
      genome: [{ habitat: pool.stockTokenSymbol, weight: 100 }],
    },
    edges: [
      {
        id: `v4-${pool.poolId}`,
        speciesId: presentation.id,
        habitat: pool.stockTokenSymbol,
        sourceProtocol: "uniswap-v4",
        strength,
      },
    ],
  };
}
