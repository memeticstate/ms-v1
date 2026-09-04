import { z } from "zod";

import { getD1, getRuntimeBinding } from "@/db";
import { recordSourceObservation } from "@/db/engine-ledger";
import { recordRpcObservations } from "@/db/rpc-health";
import type { RpcProviderObservation, SnapshotReconciliation } from "@/lib/affinity-model";
import {
  assessRobinhoodRpcQuorum,
  ROBINHOOD_RPC_MINIMUM_QUORUM,
  ROBINHOOD_RPC_TARGET_QUORUM,
} from "@/lib/ingestion/rpc-quorum";

const DEFAULT_PROVIDERS = [
  { name: "publicnode", url: "https://robinhood-rpc.publicnode.com" },
  { name: "blockmachine", url: "https://rpc-robinhood.blockmachine.io" },
  { name: "tenderly", url: "https://robinhood-chain.gateway.tenderly.co" },
  { name: "solidrpc", url: "https://rpc.solidrpc.io/public/evm/4663" },
  { name: "robinhood-public", url: "https://rpc.mainnet.chain.robinhood.com" },
];
const EXPECTED_CHAIN_ID = 4663;
const MAX_HEAD_AGE_MS = 3 * 60 * 1000;
const RPC_TIMEOUT_MS = 8_000;
const RPC_ATTEMPTS = 2;
const ATTESTATION_TTL_MS = 6 * 60 * 60 * 1000;

const rpcEnvelopeSchema = z.array(z.object({
  id: z.number(),
  result: z.unknown().optional(),
  error: z.object({ code: z.number(), message: z.string() }).optional(),
}));
const blockSchema = z.object({
  number: z.string().regex(/^0x[0-9a-f]+$/i),
  hash: z.string().regex(/^0x[0-9a-f]{64}$/i),
  timestamp: z.string().regex(/^0x[0-9a-f]+$/i),
});
const receiptSchema = z.object({
  status: z.literal("0x1"),
  blockNumber: z.string().regex(/^0x[0-9a-f]+$/i),
  blockHash: z.string().regex(/^0x[0-9a-f]{64}$/i),
  logs: z.array(z.object({ address: z.string().regex(/^0x[0-9a-f]{40}$/i) })),
});

export type ReconciliationInput = { speciesId: string; contract: string; launchTxHash: string };
export type MultiplierInput = { symbol: string; contract: string; expectedMultiplier?: string };
export type ReconciliationRecord = ReconciliationInput & {
  launchBlockNumber: number;
  codeVerified: boolean;
  launchVerified: boolean;
  codeHash: string;
};
export type ReconciliationEvidence = {
  reconciliation: SnapshotReconciliation;
  records: ReconciliationRecord[];
  multiplierEvidence: MultiplierEvidence[];
};

export type MultiplierEvidence = {
  symbol: string;
  contract: string;
  expected?: string;
  onchain: string;
  verified: boolean;
};

type Provider = { name: string; url: string };
type Head = { provider: Provider; block: z.infer<typeof blockSchema>; latencyMs: number };
type Evidence = Head & { fingerprint: string; records: ReconciliationRecord[]; multiplierEvidence: MultiplierEvidence[] };

function hexNumber(value: string) {
  return Number.parseInt(value.slice(2), 16);
}

function toHex(value: number) {
  return `0x${value.toString(16)}`;
}

function decimalToWei(value?: string) {
  if (!value || !/^\d+(?:\.\d+)?$/.test(value)) return null;
  const [whole, fraction = ""] = value.split(".");
  return BigInt(whole) * 10n ** 18n + BigInt(fraction.padEnd(18, "0").slice(0, 18));
}

function weiToDecimal(value: bigint) {
  const whole = value / 10n ** 18n;
  const fraction = (value % 10n ** 18n).toString().padStart(18, "0");
  return `${whole}.${fraction}`;
}

function providerList(): Provider[] {
  const configured = (String(getRuntimeBinding("RH_RPC_URLS") || getRuntimeBinding("RH_RPC_URL") || ""))
    .split(",")
    .map((url) => url.trim())
    .filter(Boolean)
    .map((url, index) => ({ name: `managed-${index + 1}`, url }));
  const unique = new Map<string, Provider>();
  for (const provider of [...configured, ...DEFAULT_PROVIDERS]) unique.set(provider.url, provider);
  return [...unique.values()];
}

function errorCode(error: unknown) {
  if (error instanceof DOMException && error.name === "TimeoutError") return "timeout";
  if (!(error instanceof Error)) return "unknown";
  if (/^http_\d+$/.test(error.message)) return error.message;
  if (/^rpc_-?\d+$/.test(error.message)) return error.message;
  if (["chain_mismatch", "stale_head", "evidence_mismatch"].includes(error.message)) return error.message;
  return "invalid_response";
}

async function rpcBatch(provider: Provider, requests: unknown[]) {
  const startedAt = Date.now();
  let lastError: unknown;
  for (let attempt = 1; attempt <= RPC_ATTEMPTS; attempt += 1) {
    try {
      const response = await fetch(provider.url, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          accept: "application/json",
          "user-agent": "Memetic-State/0.4 (+https://memetic-state.z3c4.chatgpt.site)",
        },
        body: JSON.stringify(requests),
        signal: AbortSignal.timeout(RPC_TIMEOUT_MS),
      });
      if (!response.ok) {
        const error = new Error(`http_${response.status}`);
        if (attempt >= RPC_ATTEMPTS || (response.status !== 429 && response.status < 500)) throw error;
        lastError = error;
      } else {
        const envelopes = rpcEnvelopeSchema.parse(await response.json());
        const rpcError = envelopes.find((item) => item.error)?.error;
        if (rpcError) throw new Error(`rpc_${rpcError.code}`);
        return { byId: new Map(envelopes.map((item) => [item.id, item.result])), latencyMs: Date.now() - startedAt };
      }
    } catch (error) {
      lastError = error;
      if (attempt >= RPC_ATTEMPTS || (error instanceof Error && /^http_4(?!29)\d{2}$/.test(error.message))) throw error;
    }
    await new Promise((resolve) => setTimeout(resolve, 140 * attempt));
  }
  throw lastError instanceof Error ? lastError : new Error("rpc_unavailable");
}

async function readHead(provider: Provider): Promise<Head> {
  const { byId, latencyMs } = await rpcBatch(provider, [
    { jsonrpc: "2.0", id: 1, method: "eth_chainId", params: [] },
    { jsonrpc: "2.0", id: 2, method: "eth_getBlockByNumber", params: ["latest", false] },
  ]);
  const chainHex = z.string().regex(/^0x[0-9a-f]+$/i).parse(byId.get(1));
  if (hexNumber(chainHex) !== EXPECTED_CHAIN_ID) throw new Error("chain_mismatch");
  const block = blockSchema.parse(byId.get(2));
  if (Date.now() - hexNumber(block.timestamp) * 1000 > MAX_HEAD_AGE_MS) throw new Error("stale_head");
  return { provider, block, latencyMs };
}

async function readEvidence(
  head: Head,
  verificationInputs: ReconciliationInput[],
  multiplierInputs: MultiplierInput[],
  blockNumber: number,
): Promise<Evidence> {
  const requests = [
    { jsonrpc: "2.0", id: 2, method: "eth_getBlockByNumber", params: [toHex(blockNumber), false] },
    ...verificationInputs.flatMap((input, index) => [
      { jsonrpc: "2.0", id: 100 + index, method: "eth_getCode", params: [input.contract, toHex(blockNumber)] },
      { jsonrpc: "2.0", id: 200 + index, method: "eth_getTransactionReceipt", params: [input.launchTxHash] },
    ]),
    ...multiplierInputs.map((input, index) => ({
      jsonrpc: "2.0", id: 300 + index, method: "eth_call",
      params: [{ to: input.contract, data: "0xa60bf13d" }, toHex(blockNumber)],
    })),
  ];
  const { byId, latencyMs } = await rpcBatch(head.provider, requests);
  const block = blockSchema.parse(byId.get(2));
  const codes: string[] = [];
  const receiptBlocks: Array<[string, number, string]> = [];
  const records = await Promise.all(verificationInputs.map(async (input, index) => {
    const code = z.string().regex(/^0x[0-9a-f]*$/i).parse(byId.get(100 + index));
    const receipt = receiptSchema.parse(byId.get(200 + index));
    const codeVerified = code !== "0x" && code !== "0x0";
    const launchVerified = receipt.logs.some((log) => log.address.toLowerCase() === input.contract.toLowerCase());
    if (!codeVerified || !launchVerified) throw new Error("evidence_mismatch");
    codes[index] = code.toLowerCase();
    receiptBlocks[index] = [input.speciesId, hexNumber(receipt.blockNumber), receipt.blockHash.toLowerCase()];
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(code.toLowerCase()));
    const codeHash = [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
    return {
      ...input,
      launchBlockNumber: hexNumber(receipt.blockNumber),
      codeVerified,
      launchVerified,
      codeHash,
    };
  }));
  const multiplierEvidence = multiplierInputs.map((input, index) => {
    const encoded = z.string().regex(/^0x[0-9a-f]{64}$/i).parse(byId.get(300 + index));
    const onchainWei = BigInt(encoded);
    const expectedWei = decimalToWei(input.expectedMultiplier);
    return {
      symbol: input.symbol,
      contract: input.contract,
      expected: input.expectedMultiplier,
      onchain: weiToDecimal(onchainWei),
      verified: expectedWei === null || (onchainWei >= expectedWei ? onchainWei - expectedWei : expectedWei - onchainWei) <= 1n,
    };
  });
  const fingerprint = JSON.stringify({
    blockHash: block.hash.toLowerCase(),
    codes,
    receipts: receiptBlocks,
    multipliers: multiplierEvidence.map((item) => [item.contract.toLowerCase(), item.onchain]),
  });
  return { provider: head.provider, block, latencyMs: head.latencyMs + latencyMs, fingerprint, records, multiplierEvidence };
}

type AttestationRow = {
  contract_address: string;
  species_id: string;
  launch_tx_hash: string;
  launch_block_number: number;
  code_hash: string;
  code_verified: number;
  launch_verified: number;
  provider_quorum: number;
  last_verified_at: number;
};

async function loadAttestations(inputs: ReconciliationInput[], force: boolean) {
  if (!inputs.length || force) return new Map<string, AttestationRow>();
  const placeholders = inputs.map(() => "?").join(",");
  const result = await getD1().prepare(`SELECT contract_address, species_id, launch_tx_hash, launch_block_number,
      code_hash, code_verified, launch_verified, provider_quorum, last_verified_at
    FROM contract_attestations WHERE contract_address IN (${placeholders})`)
    .bind(...inputs.map((input) => input.contract.toLowerCase()))
    .all<AttestationRow>();
  const fresh = result.results.filter((row) => Date.now() - row.last_verified_at <= ATTESTATION_TTL_MS
    && row.code_verified === 1 && row.launch_verified === 1
    && row.provider_quorum >= ROBINHOOD_RPC_MINIMUM_QUORUM);
  return new Map(fresh.map((row) => [row.contract_address.toLowerCase(), row]));
}

async function persistAttestations(records: ReconciliationRecord[], quorum: number, verifiedAt = Date.now()) {
  if (!records.length) return;
  const db = getD1();
  await db.batch(records.map((record) => db.prepare(`INSERT INTO contract_attestations
    (contract_address, species_id, launch_tx_hash, launch_block_number, code_hash, code_verified, launch_verified,
     provider_quorum, first_verified_at, last_verified_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(contract_address) DO UPDATE SET
      species_id = excluded.species_id, launch_tx_hash = excluded.launch_tx_hash,
      launch_block_number = excluded.launch_block_number, code_hash = excluded.code_hash,
      code_verified = excluded.code_verified, launch_verified = excluded.launch_verified,
      provider_quorum = excluded.provider_quorum, last_verified_at = excluded.last_verified_at`)
    .bind(
      record.contract.toLowerCase(), record.speciesId, record.launchTxHash, record.launchBlockNumber,
      record.codeHash, record.codeVerified ? 1 : 0, record.launchVerified ? 1 : 0,
      quorum, verifiedAt, verifiedAt,
    )));
}

export async function reconcileRobinhoodChain(
  inputs: ReconciliationInput[],
  options: { runId?: string; forceAttestation?: boolean; multiplierInputs?: MultiplierInput[] } = {},
): Promise<ReconciliationEvidence> {
  const startedAt = Date.now();
  const observedAt = new Date().toISOString();
  const providers = providerList();
  const cached = await loadAttestations(inputs, options.forceAttestation ?? false);
  const toVerify = inputs.filter((input) => {
    const row = cached.get(input.contract.toLowerCase());
    return !row || row.launch_tx_hash.toLowerCase() !== input.launchTxHash.toLowerCase();
  });
  const observations = new Map<string, RpcProviderObservation>();
  const headResults = await Promise.all(providers.map(async (provider) => {
    const startedAt = Date.now();
    try {
      return await readHead(provider);
    } catch (error) {
      observations.set(provider.name, {
        provider: provider.name,
        status: "failed",
        observedAt,
        latencyMs: Date.now() - startedAt,
        errorCode: errorCode(error),
      });
      return null;
    }
  }));
  const heads = headResults.filter((head): head is Head => head !== null);
  for (const head of heads) {
    observations.set(head.provider.name, {
      provider: head.provider.name,
      status: "healthy",
      observedAt,
      latencyMs: head.latencyMs,
      blockNumber: hexNumber(head.block.number),
      blockHash: head.block.hash,
    });
  }
  if (!assessRobinhoodRpcQuorum({ agreedProviders: heads.length }).accepted) {
    await recordRpcObservations([...observations.values()]).catch(() => undefined);
    throw new Error("RPC quorum unavailable");
  }

  const commonBlockNumber = Math.min(...heads.map((head) => hexNumber(head.block.number)));
  const evidenceResults = await Promise.all(heads.map(async (head) => {
    try {
      return await readEvidence(head, toVerify, options.multiplierInputs ?? [], commonBlockNumber);
    } catch (error) {
      observations.set(head.provider.name, {
        provider: head.provider.name,
        status: "failed",
        observedAt,
        latencyMs: head.latencyMs,
        blockNumber: hexNumber(head.block.number),
        blockHash: head.block.hash,
        errorCode: errorCode(error),
      });
      return null;
    }
  }));
  const evidence = evidenceResults.filter((item): item is Evidence => item !== null);
  const groups = new Map<string, Evidence[]>();
  for (const item of evidence) groups.set(item.fingerprint, [...(groups.get(item.fingerprint) ?? []), item]);
  const agreed = [...groups.values()].sort((a, b) => b.length - a.length)[0] ?? [];
  for (const item of evidence) {
    observations.set(item.provider.name, {
      provider: item.provider.name,
      status: agreed.includes(item) ? "healthy" : "disagreeing",
      observedAt,
      latencyMs: item.latencyMs,
      blockNumber: commonBlockNumber,
      blockHash: item.block.hash,
      ...(!agreed.includes(item) ? { errorCode: "quorum_disagreement" } : {}),
    });
  }
  await recordRpcObservations([...observations.values()]).catch(() => undefined);
  if (!assessRobinhoodRpcQuorum({ agreedProviders: agreed.length }).accepted) {
    throw new Error("RPC evidence disagreement");
  }

  const canonical = agreed[0];
  const multiplierVerified = canonical.multiplierEvidence.filter((item) => item.verified).length;
  const quorumAssessment = assessRobinhoodRpcQuorum({
    agreedProviders: agreed.length,
    multiplierVerified,
    multiplierTotal: canonical.multiplierEvidence.length,
  });
  await persistAttestations(canonical.records, agreed.length);
  const newlyVerified = new Map(canonical.records.map((record) => [record.contract.toLowerCase(), record]));
  const records = inputs.map((input) => {
    const fresh = newlyVerified.get(input.contract.toLowerCase());
    if (fresh) return fresh;
    const row = cached.get(input.contract.toLowerCase());
    if (!row) throw new Error("attestation_missing");
    return {
      ...input,
      launchBlockNumber: row.launch_block_number,
      codeVerified: Boolean(row.code_verified),
      launchVerified: Boolean(row.launch_verified),
      codeHash: row.code_hash,
    };
  });
  if (options.runId) {
    await recordSourceObservation(options.runId, {
      source: "robinhood-rpc",
      status: quorumAssessment.degraded ? "stale" : "ok",
      startedAt,
      completedAt: Date.now(),
      freshnessMs: Math.max(0, Date.now() - hexNumber(canonical.block.timestamp) * 1000),
      recordCount: records.length,
      metadata: {
        chainId: EXPECTED_CHAIN_ID,
        blockNumber: commonBlockNumber,
        providers: providers.length,
        quorum: agreed.length,
        minimumQuorum: ROBINHOOD_RPC_MINIMUM_QUORUM,
        targetQuorum: ROBINHOOD_RPC_TARGET_QUORUM,
        attestationsReused: inputs.length - toVerify.length,
        attestationsRefreshed: toVerify.length,
        multiplierVerified,
        multiplierTotal: canonical.multiplierEvidence.length,
      },
    });
  }
  return {
    reconciliation: {
      status: "verified",
      chainId: EXPECTED_CHAIN_ID,
      blockNumber: commonBlockNumber,
      blockHash: canonical.block.hash,
      observedAt: new Date(hexNumber(canonical.block.timestamp) * 1000).toISOString(),
      verifiedSpecies: records.length,
      totalSpecies: inputs.length,
      providerCount: providers.length,
      quorum: agreed.length,
      degraded: quorumAssessment.degraded,
      confidence: Math.round(60 + (agreed.length / providers.length) * 25
        + (canonical.multiplierEvidence.length ? multiplierVerified / canonical.multiplierEvidence.length : 1) * 15),
      attestationsReused: inputs.length - toVerify.length,
      multiplierVerified,
    },
    records,
    multiplierEvidence: canonical.multiplierEvidence,
  };
}
