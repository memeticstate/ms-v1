import { TOKEN_GATE_CHAIN_ID, type TokenGateOnchainResult } from "./token-adapter";

export type SupplyReference = {
  supply_raw: string;
  decimals: number;
  block_number: number;
  recorded_at: number;
};

export async function readSupplyReference(db: D1Database, contract: string) {
  return db.prepare(`SELECT supply_raw, decimals, block_number, recorded_at
    FROM premium_supply_references WHERE chain_id = ? AND contract_address = ?`)
    .bind(TOKEN_GATE_CHAIN_ID, contract.toLowerCase()).first<SupplyReference>();
}

export async function pinSupplyReference(db: D1Database, result: TokenGateOnchainResult, now: number) {
  // First verified activation fixes the denominator. Concurrent initial checks
  // converge on one row; subsequent burns never overwrite it.
  await db.prepare(`INSERT OR IGNORE INTO premium_supply_references
    (chain_id, contract_address, supply_raw, decimals, block_number, recorded_at)
    VALUES (?, ?, ?, ?, ?, ?)`)
    .bind(TOKEN_GATE_CHAIN_ID, result.contractAddress, result.totalSupplyRaw, result.decimals, result.blockNumber, now).run();
  const reference = await readSupplyReference(db, result.contractAddress);
  if (!reference || !/^[1-9][0-9]*$/.test(reference.supply_raw) || reference.decimals !== result.decimals) {
    throw new Error("token_gate_reference_unavailable");
  }
  return reference;
}
