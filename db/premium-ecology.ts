import { getD1 } from "@/db";
import type { PonsTokenEvidence } from "@/lib/pons/model";
import { EXPLORER } from "@/lib/premium/research";
import type { ResearchEcology, EcologyPeer, EcologySource } from "@/lib/premium/workflow";

const iso = (ms: number | null | undefined) => ms == null ? null : new Date(ms).toISOString();
type PeerRow = { token_address: string; token_symbol: string | null; block_timestamp: number; generation?: string };

export async function readPremiumEcology(input: { token: string; quoteAddress: string; quoteSymbol: string; through: number; collectedAt: string | null; holder: PonsTokenEvidence | null; current: boolean }): Promise<ResearchEcology> {
  const db = getD1();
  const [asset, v2, v1, pair, sameToken] = await Promise.all([
    db.prepare(`SELECT token_symbol, token_name, observed_at FROM robinhood_assets WHERE contract_address = ? AND chain_id = 4663`)
      .bind(input.quoteAddress.toLowerCase()).first<{ token_symbol: string; token_name: string; observed_at: number }>(),
    db.prepare(`SELECT token_address, token_symbol, block_timestamp FROM pons_launches
      WHERE pair_token_address = ? AND block_number <= ? AND token_address <> ? ORDER BY block_number DESC LIMIT 8`)
      .bind(input.quoteAddress.toLowerCase(), input.through, input.token).all<PeerRow>(),
    db.prepare(`SELECT l.token_address, l.token_symbol, l.block_timestamp, l.generation FROM pons_v1_launches l
      JOIN pons_generation_index_state g ON g.id = l.generation
      WHERE l.pair_token_address = ? AND l.block_number < g.launch_next_block AND l.block_number <= ? AND l.token_address <> ?
      ORDER BY l.block_number DESC LIMIT 8`).bind(input.quoteAddress.toLowerCase(), input.through, input.token).all<PeerRow>(),
    db.prepare(`SELECT s.contract_address, s.symbol, s.observed_at, s.protocol FROM affinity_edge_observations e
      JOIN species_observations s ON s.snapshot_id = e.snapshot_id AND s.species_id = e.species_id
      WHERE e.habitat = ? AND e.observed_at = (SELECT MAX(observed_at) FROM affinity_edge_observations WHERE habitat = ?)
      ORDER BY e.strength DESC LIMIT 8`).bind(input.quoteSymbol, input.quoteSymbol)
      .all<{ contract_address: string; symbol: string; observed_at: number; protocol: string }>(),
    db.prepare(`SELECT symbol, observed_at, protocol FROM species_observations WHERE contract_address = ? ORDER BY observed_at DESC LIMIT 1`)
      .bind(input.token).first<{ symbol: string; observed_at: number; protocol: string }>(),
  ]);
  const quote = asset ? await db.prepare(`SELECT mid, halted, observed_at FROM robinhood_quotes WHERE symbol = ? ORDER BY observed_at DESC LIMIT 1`)
    .bind(asset.token_symbol).first<{ mid: number; halted: number; observed_at: number }>() : null;
  const peers: EcologyPeer[] = [
    ...v2.results.map(row => ({ address: row.token_address, symbol: row.token_symbol || row.token_address.slice(0, 10), source: "PONS V2", relationship: "Exact quote-contract match", observedAt: iso(row.block_timestamp * 1000)!, url: `${EXPLORER}/token/${row.token_address}` })),
    ...v1.results.map(row => ({ address: row.token_address, symbol: row.token_symbol || row.token_address.slice(0, 10), source: `PONS ${row.generation}`, relationship: "Exact quote-contract match", observedAt: iso(row.block_timestamp * 1000)!, url: `${EXPLORER}/token/${row.token_address}` })),
    ...pair.results.map(row => ({ address: row.contract_address, symbol: row.symbol, source: row.protocol, relationship: "Same named habitat · taxonomy match only", observedAt: iso(row.observed_at)!, url: `${EXPLORER}/token/${row.contract_address}` })),
  ];
  const sources: EcologySource[] = [
    { id: "pons", label: "PONS event index", status: "recorded", observedAt: input.collectedAt, relationship: "Launch and quote contract", detail: `PONS peers use the same quote contract and are limited to committed launches through block ${input.through.toLocaleString()}.`, url: `${EXPLORER}/token/${input.token}`, stale: true },
    { id: "holder", label: input.holder?.sampleBasis === "indexed-actors" ? "Indexed-actor balance sample" : "Explorer holder sample", status: input.holder?.observedAt ? "recorded" : "missing", observedAt: input.holder?.observedAt ?? null, relationship: "Exact token contract", detail: input.holder?.observedAt ? `${input.holder.holderSampleSize} wallets sampled. ${input.holder.holdersComplete ? "Returned distribution complete." : "Partial distribution."}` : "No dated holder sample is available.", url: `${EXPLORER}/token/${input.token}?tab=holders`, stale: true },
    { id: "registry", label: "Robinhood asset registry", status: asset ? "recorded" : "missing", observedAt: iso(asset?.observed_at), relationship: "Exact quote contract and chain", detail: asset ? `${asset.token_name} (${asset.token_symbol}) matches the launch's quote contract.` : "No exact registry match was found. A ticker match is insufficient.", url: "https://api.robinhood.com/rhj/assets", stale: true },
    { id: "pair", label: "PAIR API sample · up to 12 tokens", status: sameToken || pair.results.length ? "recorded" : "missing", observedAt: iso(sameToken?.observed_at ?? pair.results[0]?.observed_at), relationship: sameToken ? "Exact token-contract observation" : "Named habitat context only", detail: sameToken ? `${sameToken.protocol} has a dated observation of the same token contract in the selected API sample.` : pair.results.length ? "These sampled tokens share a recorded habitat label. This does not establish a shared pool, collateral, or shared performance." : "No matching contract or habitat observations are available in the selected API sample.", url: "https://pair.fund", stale: true },
  ].map((source) => ({ ...source, stale: (source.id === "pons" && !input.current) || !source.observedAt || Date.now() - Date.parse(source.observedAt) > 15 * 60_000 })) as EcologySource[];
  return { sources, peers, quote: quote && asset ? { symbol: asset.token_symbol, observedAt: iso(quote.observed_at)!, mid: quote.mid, halted: Boolean(quote.halted) } : null,
    limitation: "Sources have separate observation times; this is not a synchronized market snapshot or a correlation score. PONS generations and explorer views share underlying chain data. PAIR is a selected API sample, not a complete factory or trade index; habitat labels are contextual links. OTC desks and Stonkfun are not indexed here." };
}
