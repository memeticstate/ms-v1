import { robinhoodExplorer } from "@/lib/robinhood-explorer";
import { getD1 } from "@/db";
import { currentPonsEvidence } from "@/lib/pons/research";
import type { PonsStateResponse } from "@/lib/pons/model";
import { readPremiumEcology } from "./premium-ecology";
import { researchWorkflow, type ResearchSelection } from "@/lib/premium/workflow";
import { COMPARISON_SAMPLE_LIMIT, COMPARISON_WINDOW_BLOCKS, HISTORY_PAGE_SIZE, pageEvidence, researchNote, type EvidenceRecord, type ResearchDossier, type ResearchWindow } from "@/lib/premium/research";

export type ResearchQuery = { token: string; cursor: { block: number; log: number } | null; through: number | null; windowBlocks?: number; kind?: ResearchSelection["kind"]; scope?: ResearchSelection["scope"] };
type RawRecord = { id: string; kind: string; block_number: number; log_index: number; block_timestamp: number; observed_at: number; tx_hash: string; actor: string | null; quote_amount_raw: string | null; token_amount_raw: string | null };
const secondsIso = (value: number | null) => value === null ? null : new Date(value * 1_000).toISOString();

export const premiumTradeQuery = `SELECT id, side AS kind, block_number, log_index, block_timestamp, observed_at, tx_hash,
  actor_address AS actor, quote_amount_raw, token_amount_raw
  FROM pons_curve_trades WHERE token_address = ? AND block_number <= ?
    AND (block_number < ? OR (block_number = ? AND log_index < ?))
    AND block_number >= ? AND (? = 'all' OR side = ?)
  ORDER BY block_number DESC, log_index DESC LIMIT ?`;
export const premiumEventQuery = `SELECT id, event_type AS kind, block_number, log_index, block_timestamp, observed_at, tx_hash,
  emitter_address AS actor, NULL AS quote_amount_raw, NULL AS token_amount_raw
  FROM pons_events WHERE token_address = ? AND block_number <= ?
    AND (block_number < ? OR (block_number = ? AND log_index < ?))
    AND block_number >= ? AND (? = 'all' OR ? = 'lifecycle')
  ORDER BY block_number DESC, log_index DESC LIMIT ?`;
export const premiumWindowQuery = `SELECT COUNT(*) AS trades, COUNT(DISTINCT actor_address) AS actors,
  COALESCE(SUM(side = 'buy'), 0) AS buys, COALESCE(SUM(side = 'sell'), 0) AS sells,
  MIN(block_timestamp) AS first_trade, MAX(block_timestamp) AS last_trade
  FROM (SELECT actor_address, side, block_timestamp FROM pons_curve_trades
    WHERE token_address = ? AND block_number BETWEEN ? AND ? ORDER BY block_number DESC LIMIT ?)`;

export async function readPremiumDossier(state: PonsStateResponse, query: ResearchQuery): Promise<ResearchDossier | null> {
  const launch = state.launches.find((item) => item.tokenAddress.toLowerCase() === query.token);
  if (!launch) return null;
  const through = Math.min(query.through ?? state.index.latestIndexedBlock, state.index.latestIndexedBlock);
  const cursor = query.cursor ?? { block: through + 1, log: 0 };
  const db = getD1();
  const selection: ResearchSelection = { windowBlocks: query.windowBlocks ?? COMPARISON_WINDOW_BLOCKS, kind: query.kind ?? "all", scope: query.scope ?? "all" };
  const from = selection.scope === "window" ? Math.max(0, through - selection.windowBlocks + 1) : 0;
  const args = [query.token, through, cursor.block, cursor.block, cursor.log, from, selection.kind, selection.kind, HISTORY_PAGE_SIZE + 1];
  const periods = ["Latest indexed window", "Previous window", "Earlier window"].map((label, i) => ({
    label, fromBlock: Math.max(0, through - selection.windowBlocks * (i + 1) + 1), toBlock: Math.max(0, through - selection.windowBlocks * i),
  }));
  const [tradeResult, eventResult, quote, earliest, ...stats] = await Promise.all([
    db.prepare(premiumTradeQuery).bind(...args).all<RawRecord>(),
    db.prepare(premiumEventQuery).bind(...args).all<RawRecord>(),
    db.prepare("SELECT pair_decimals FROM pons_launches WHERE token_address = ?").bind(query.token).first<{ pair_decimals: number }>(),
    db.prepare("SELECT block_timestamp FROM pons_curve_trades WHERE token_address = ? AND block_number <= ? ORDER BY block_number ASC LIMIT 1")
      .bind(query.token, through).first<{ block_timestamp: number }>(),
    ...periods.map((period) => db.prepare(premiumWindowQuery).bind(query.token, period.fromBlock, period.toBlock, COMPARISON_SAMPLE_LIMIT)
      .first<{ trades: number; actors: number; buys: number; sells: number; first_trade: number | null; last_trade: number | null }>()),
  ]);
  const records: EvidenceRecord[] = [...tradeResult.results, ...eventResult.results].map((row) => ({
    id: row.id, kind: row.kind, blockNumber: row.block_number, logIndex: row.log_index,
    observedAt: secondsIso(row.block_timestamp)!, indexedAt: new Date(row.observed_at).toISOString(),
    transaction: row.tx_hash, sourceUrl: robinhoodExplorer.tx(row.tx_hash), actor: row.actor,
    quoteAmountRaw: row.quote_amount_raw, tokenAmountRaw: row.token_amount_raw,
  }));
  if (!quote || !Number.isInteger(quote.pair_decimals) || quote.pair_decimals < 0 || quote.pair_decimals > 36) throw new Error("quote_metadata_unavailable");
  const windows: ResearchWindow[] = periods.map((period, index) => {
    const row = stats[index];
    return { ...period, trades: row?.trades ?? 0, actors: row?.actors ?? 0, buys: row?.buys ?? 0, sells: row?.sells ?? 0,
      sampled: (row?.trades ?? 0) >= COMPARISON_SAMPLE_LIMIT, firstTradeAt: secondsIso(row?.first_trade ?? null), lastTradeAt: secondsIso(row?.last_trade ?? null) };
  });
  const current = currentPonsEvidence(state) && through === state.index.latestIndexedBlock;
  const ecology = await readPremiumEcology({ token: query.token, quoteAddress: launch.pairTokenAddress, quoteSymbol: launch.pairSymbol, through, collectedAt: state.index.lastSuccessAt, holder: launch.currentEvidence ?? null, current });
  const dossier: ResearchDossier = {
    version: "field-operator-v2", generatedAt: new Date().toISOString(), selection, ecology, prompts: [], invalidationPaths: [],
    token: { address: query.token, name: launch.name, symbol: launch.symbol, curveAddress: launch.curveAddress, creator: launch.deployerAddress,
      quoteAddress: launch.pairTokenAddress, quoteSymbol: launch.pairSymbol, quoteDecimals: quote.pair_decimals, launchedAt: launch.launchedAt, launchTransaction: launch.txHash },
    coverage: { source: "PONS V2 · indexed curve events on Robinhood Chain", throughBlock: through, latestObservedBlock: state.index.latestSeenBlock,
      lagBlocks: Math.max(0, state.index.latestSeenBlock - through), lastCollectedAt: state.index.lastSuccessAt, current, historyComplete: false,
      earliestIndexedTradeAt: secondsIso(earliest?.block_timestamp ?? null), limitation: "Available indexed records, with possible collection gaps. An empty window does not establish zero onchain activity. Post-graduation pool swaps and complete holder retention are not included." },
    note: researchNote(launch, windows, current), holderEvidence: launch.currentEvidence ?? null, windows,
    history: { ...pageEvidence(records), throughBlock: through, pageCursor: query.cursor ? `${query.cursor.block}:${query.cursor.log}` : null },
  };
  return { ...dossier, ...researchWorkflow(dossier) };
}
