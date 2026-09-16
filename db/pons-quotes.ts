import { getD1 } from "@/db";

/** Resolve previously discovered quotes after the official asset registry catches up.
 * Factory ingestion retains every quote address, even before it has a registry entry.
 * Update presentation/units only; never change launches, trades or index cursors.
 */
export async function reconcilePonsQuoteAssets() {
  const db = getD1();
  const active = "a.chain_id = 4663 AND a.status = 'ASSET_STATUS_ACTIVE' AND TRIM(a.token_symbol) <> ''";
  await db.batch([
    db.prepare(`UPDATE pons_launches AS l SET
      pair_symbol = (SELECT a.token_symbol FROM robinhood_assets a WHERE LOWER(a.contract_address) = l.pair_token_address AND ${active}),
      pair_decimals = COALESCE((SELECT a.token_decimals FROM robinhood_assets a WHERE LOWER(a.contract_address) = l.pair_token_address AND ${active} AND a.token_decimals BETWEEN 0 AND 36), l.pair_decimals)
      WHERE EXISTS (SELECT 1 FROM robinhood_assets a WHERE LOWER(a.contract_address) = l.pair_token_address AND ${active}
        AND (l.pair_symbol <> a.token_symbol OR (a.token_decimals BETWEEN 0 AND 36 AND l.pair_decimals <> a.token_decimals)))`),
    db.prepare(`UPDATE pons_v1_launches AS l SET
      pair_symbol = (SELECT a.token_symbol FROM robinhood_assets a WHERE LOWER(a.contract_address) = l.pair_token_address AND ${active})
      WHERE EXISTS (SELECT 1 FROM robinhood_assets a WHERE LOWER(a.contract_address) = l.pair_token_address AND ${active} AND l.pair_symbol <> a.token_symbol)`),
  ]);
}
