export const TOKEN_GATE_CHAIN_ID = 4663;
export const PREMIUM_HOLDER_THRESHOLD_BPS = 10;
export const TOKEN_GATE_CACHE_SECONDS = 2 * 60;
export const TOKEN_GATE_ERROR_CACHE_SECONDS = 60;

const ADDRESS = /^0x[0-9a-f]{40}$/i;
const HEX = /^0x[0-9a-f]+$/i;
const RPC_TIMEOUT_MS = 4_500;
const DEFAULT_QUORUM = 2;
const MAX_BLOCK_SKEW = 12;
const BLOCK_DEPTH = 2;
const TOTAL_SUPPLY_SELECTOR = "0x18160ddd";
const BALANCE_OF_SELECTOR = "0x70a08231";

type TokenRpcProvider = { name: string; url: string };
type RpcEnvelope = { id: number; result?: unknown; error?: { code?: number; message?: string } };

const DEFAULT_PROVIDERS: TokenRpcProvider[] = [
  { name: "publicnode", url: "https://robinhood-rpc.publicnode.com" },
  { name: "blockmachine", url: "https://rpc-robinhood.blockmachine.io" },
  { name: "robinhood", url: "https://rpc.mainnet.chain.robinhood.com" },
  { name: "tenderly", url: "https://robinhood-chain.gateway.tenderly.co" },
];

export type TokenAdapterStatus = {
  state: "disabled" | "configuration_required" | "ready";
  grantingEnabled: boolean;
  chainId: typeof TOKEN_GATE_CHAIN_ID;
  contractAddress: string | null;
  thresholdBps: typeof PREMIUM_HOLDER_THRESHOLD_BPS;
  thresholdPercent: "0.1%";
  quorum: number;
  providerCount: number;
  reason: string;
};

export type TokenGateOnchainResult = {
  eligible: boolean;
  walletAddress: string;
  contractAddress: string;
  chainId: typeof TOKEN_GATE_CHAIN_ID;
  balanceRaw: string;
  totalSupplyRaw: string;
  decimals: number;
  thresholdBps: typeof PREMIUM_HOLDER_THRESHOLD_BPS;
  blockNumber: number;
  confirmations: number;
  providerCount: number;
  providers: string[];
};

function validAddress(value: unknown): value is string {
  return typeof value === "string" && ADDRESS.test(value);
}

function configuredProviders(bindings: Record<string, unknown>): TokenRpcProvider[] {
  const raw = bindings.MEMETIC_TOKEN_RPC_URLS ?? bindings.PONS_RPC_URLS ?? bindings.RH_RPC_URLS;
  const urls = typeof raw === "string" ? raw.split(",").map((url) => url.trim()).filter(Boolean) : [];
  const providers = [...urls.map((url, index) => ({ name: `managed-${index + 1}`, url })), ...DEFAULT_PROVIDERS];
  const unique = new Map<string, TokenRpcProvider>();
  for (const provider of providers) {
    try {
      const url = new URL(provider.url);
      if (url.protocol === "https:" && !unique.has(url.origin)) unique.set(url.origin, provider);
    } catch { /* Invalid configured providers cannot contribute to quorum. */ }
  }
  return [...unique.values()];
}

function configuredQuorum(bindings: Record<string, unknown>) {
  const parsed = Number(bindings.MEMETIC_TOKEN_RPC_QUORUM ?? DEFAULT_QUORUM);
  return Number.isInteger(parsed) && parsed >= DEFAULT_QUORUM ? parsed : DEFAULT_QUORUM;
}

function contractFromBindings(bindings: Record<string, unknown>) {
  const raw = bindings.MEMETIC_TOKEN_CONTRACT_ADDRESS ?? bindings.MEMETIC_TOKEN_LOCK_CONTRACT;
  const contract = typeof raw === "string" ? raw.trim().toLowerCase() : "";
  return ADDRESS.test(contract) ? contract : null;
}

function gateRequested(bindings: Record<string, unknown>) {
  return String(bindings.MEMETIC_TOKEN_ENTITLEMENTS_ENABLED ?? bindings.MEMETIC_TOKEN_GATE_ENABLED ?? "")
    .toLowerCase() === "true";
}

export function tokenAdapterStatus(bindings: Record<string, unknown> = {}): TokenAdapterStatus {
  const contractAddress = contractFromBindings(bindings);
  const quorum = configuredQuorum(bindings);
  const providerCount = configuredProviders(bindings).length;
  if (!gateRequested(bindings)) {
    return {
      state: "disabled",
      grantingEnabled: false,
      chainId: TOKEN_GATE_CHAIN_ID,
      contractAddress,
      thresholdBps: PREMIUM_HOLDER_THRESHOLD_BPS,
      thresholdPercent: "0.1%",
      quorum,
      providerCount,
      reason: "Premium holder access is paused until the token gate is enabled.",
    };
  }
  if (!contractAddress) {
    return {
      state: "configuration_required",
      grantingEnabled: false,
      chainId: TOKEN_GATE_CHAIN_ID,
      contractAddress: null,
      thresholdBps: PREMIUM_HOLDER_THRESHOLD_BPS,
      thresholdPercent: "0.1%",
      quorum,
      providerCount,
      reason: "The holder gate needs the token contract address before it can verify ownership.",
    };
  }
  if (providerCount < quorum) {
    return {
      state: "configuration_required",
      grantingEnabled: false,
      chainId: TOKEN_GATE_CHAIN_ID,
      contractAddress,
      thresholdBps: PREMIUM_HOLDER_THRESHOLD_BPS,
      thresholdPercent: "0.1%",
      quorum,
      providerCount,
      reason: "The holder gate needs enough independent RPC providers for a safe consensus check.",
    };
  }
  return {
    state: "ready",
    grantingEnabled: true,
    chainId: TOKEN_GATE_CHAIN_ID,
    contractAddress,
    thresholdBps: PREMIUM_HOLDER_THRESHOLD_BPS,
    thresholdPercent: "0.1%",
    quorum,
    providerCount,
    reason: "Holder access is checked against a quorum of Robinhood Chain RPC providers.",
  };
}

function hexNumber(value: unknown, label: string) {
  if (typeof value !== "string" || !HEX.test(value)) throw new Error(`token_gate_invalid_${label}`);
  const parsed = Number.parseInt(value.slice(2), 16);
  if (!Number.isSafeInteger(parsed) || parsed < 0) throw new Error(`token_gate_invalid_${label}`);
  return parsed;
}

function hexBigInt(value: unknown, label: string) {
  if (typeof value !== "string" || !HEX.test(value)) throw new Error(`token_gate_invalid_${label}`);
  try {
    return BigInt(value);
  } catch {
    throw new Error(`token_gate_invalid_${label}`);
  }
}

function balanceOfData(walletAddress: string) {
  return `${BALANCE_OF_SELECTOR}${walletAddress.slice(2).toLowerCase().padStart(64, "0")}`;
}

async function rpcBatch(provider: TokenRpcProvider, calls: Array<{ method: string; params: unknown[] }>, fetcher: typeof fetch) {
  const response = await fetcher(provider.url, {
    method: "POST",
    headers: { accept: "application/json", "content-type": "application/json" },
    body: JSON.stringify(calls.map((call, index) => ({ jsonrpc: "2.0", id: index + 1, ...call }))),
    signal: AbortSignal.timeout(RPC_TIMEOUT_MS),
  });
  if (!response.ok) throw new Error(`token_gate_http_${response.status}`);
  const payload = await response.json() as unknown;
  if (!Array.isArray(payload) || payload.length !== calls.length) throw new Error("token_gate_invalid_rpc_batch");
  const byId = new Map((payload as RpcEnvelope[]).map((item) => [item.id, item]));
  if (byId.size !== calls.length || calls.some((_, index) => !byId.has(index + 1))) throw new Error("token_gate_incomplete_rpc_batch");
  const failed = [...byId.values()].find((item) => item.error);
  if (failed?.error) throw new Error(`token_gate_rpc_${failed.error.code ?? "error"}`);
  return byId;
}

async function readHead(provider: TokenRpcProvider, fetcher: typeof fetch) {
  const byId = await rpcBatch(provider, [
    { method: "eth_chainId", params: [] },
    { method: "eth_blockNumber", params: [] },
  ], fetcher);
  const chainId = hexNumber(byId.get(1)?.result, "chain");
  if (chainId !== TOKEN_GATE_CHAIN_ID) throw new Error("token_gate_chain_mismatch");
  return { provider, blockNumber: hexNumber(byId.get(2)?.result, "block") };
}

async function readProvider(provider: TokenRpcProvider, contractAddress: string, walletAddress: string, blockNumber: number, fetcher: typeof fetch) {
  const block = `0x${blockNumber.toString(16)}`;
  const byId = await rpcBatch(provider, [
    { method: "eth_call", params: [{ to: contractAddress, data: TOTAL_SUPPLY_SELECTOR }, block] },
    { method: "eth_call", params: [{ to: contractAddress, data: balanceOfData(walletAddress) }, block] },
    { method: "eth_call", params: [{ to: contractAddress, data: "0x313ce567" }, block] },
    { method: "eth_getBlockByNumber", params: [block, false] },
  ], fetcher);
  const header = byId.get(4)?.result as { hash?: unknown; number?: unknown } | null;
  if (!header || typeof header.hash !== "string" || !/^0x[0-9a-f]{64}$/i.test(header.hash)
    || hexNumber(header.number, "block") !== blockNumber) throw new Error("token_gate_invalid_block_header");
  const decimals = hexNumber(byId.get(3)?.result, "decimals");
  if (decimals > 36) throw new Error("token_gate_invalid_decimals");
  return {
    provider: provider.name,
    blockNumber,
    blockHash: header.hash.toLowerCase(),
    totalSupply: hexBigInt(byId.get(1)?.result, "total_supply"),
    balance: hexBigInt(byId.get(2)?.result, "balance"),
    decimals,
  };
}

function qualifiesForPremium(balanceRaw: bigint, totalSupplyRaw: bigint) {
  return totalSupplyRaw > 0n && balanceRaw * 10_000n >= totalSupplyRaw * BigInt(PREMIUM_HOLDER_THRESHOLD_BPS);
}

export { balanceOfData, qualifiesForPremium };

export async function readTokenGateOnchain(input: {
  walletAddress: string;
  bindings?: Record<string, unknown>;
  fetcher?: typeof fetch;
}): Promise<TokenGateOnchainResult> {
  const bindings = input.bindings ?? {};
  const walletAddress = input.walletAddress.trim().toLowerCase();
  const contractAddress = contractFromBindings(bindings);
  if (!validAddress(walletAddress)) throw new Error("token_gate_invalid_wallet");
  if (!contractAddress) throw new Error("token_gate_contract_missing");
  if (!gateRequested(bindings)) throw new Error("token_gate_disabled");
  const quorum = configuredQuorum(bindings);
  const fetcher = input.fetcher ?? fetch;
  const heads = (await Promise.allSettled(configuredProviders(bindings).map((provider) => readHead(provider, fetcher))))
    .flatMap((result) => result.status === "fulfilled" ? [result.value] : [])
    .sort((a, b) => b.blockNumber - a.blockNumber);
  const cluster = heads.map((head) => heads.filter((candidate) => candidate.blockNumber <= head.blockNumber
    && head.blockNumber - candidate.blockNumber <= MAX_BLOCK_SKEW)).find((group) => group.length >= quorum);
  if (!cluster) throw new Error("token_gate_head_quorum_unavailable");
  const blockNumber = Math.min(...cluster.map((head) => head.blockNumber)) - BLOCK_DEPTH;
  if (blockNumber < 0) throw new Error("token_gate_block_unavailable");
  const providerResults = await Promise.allSettled(cluster.map(({ provider }) =>
    readProvider(provider, contractAddress, walletAddress, blockNumber, fetcher)));
  const successful = providerResults.flatMap((result) => result.status === "fulfilled" ? [result.value] : []);
  if (successful.length < quorum) throw new Error("token_gate_quorum_unavailable");
  const groups = new Map<string, typeof successful>();
  for (const result of successful) {
    const key = `${result.blockHash}:${result.totalSupply.toString()}:${result.balance.toString()}:${result.decimals}`;
    groups.set(key, [...(groups.get(key) ?? []), result]);
  }
  const consensus = [...groups.values()].sort((left, right) => right.length - left.length)[0];
  if (!consensus || consensus.length < quorum) throw new Error("token_gate_quorum_mismatch");
  const balanceRaw = consensus[0].balance;
  const totalSupplyRaw = consensus[0].totalSupply;
  if (totalSupplyRaw <= 0n || balanceRaw > totalSupplyRaw) {
    throw new Error("token_gate_supply_balance_invalid");
  }
  return {
    eligible: qualifiesForPremium(balanceRaw, totalSupplyRaw),
    walletAddress,
    contractAddress,
    chainId: TOKEN_GATE_CHAIN_ID,
    balanceRaw: balanceRaw.toString(),
    totalSupplyRaw: totalSupplyRaw.toString(),
    decimals: consensus[0].decimals,
    thresholdBps: PREMIUM_HOLDER_THRESHOLD_BPS,
    blockNumber,
    confirmations: BLOCK_DEPTH,
    providerCount: consensus.length,
    providers: consensus.map((result) => result.provider),
  };
}
