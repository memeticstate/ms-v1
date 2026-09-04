import { getRuntimeBinding } from "@/db";
import {
  PONS_CHAIN_ID,
  PONS_TOPICS,
  PONS_V1_GENERATIONS,
  PONS_V2_FACTORY,
  type PonsV1GenerationId,
} from "@/lib/pons/constants";
import { decodeAbiString, validRpcLog, type RpcLog } from "@/lib/pons/decode";

type Provider = { name: string; url: string; archive: boolean };
type RpcRequest = { jsonrpc: "2.0"; id: number; method: string; params: unknown[] };
type RpcEnvelope = { id: number; result?: unknown; error?: { code?: number; message?: string } };
type PonsLogBatch = {
  factoryLogs: RpcLog[];
  curveLogs: RpcLog[];
  latencyMs: number;
  provider: string;
  fromBlock: number;
  toBlock: number;
};

type ProviderHealth = {
  consecutiveFailures: number;
  cooldownUntil: number;
  lastRequestAt: number;
};

class PonsRpcError extends Error {
  readonly code: string;
  readonly status?: number;
  readonly retryAfterMs?: number;

  constructor(code: string, message: string, options: { status?: number; retryAfterMs?: number } = {}) {
    super(message);
    this.name = "PonsRpcError";
    this.code = code;
    this.status = options.status;
    this.retryAfterMs = options.retryAfterMs;
  }
}

const DEFAULT_PROVIDERS: Provider[] = [
  { name: "publicnode", url: "https://robinhood-rpc.publicnode.com", archive: true },
  { name: "blockmachine", url: "https://rpc-robinhood.blockmachine.io", archive: true },
  { name: "tenderly", url: "https://robinhood-chain.gateway.tenderly.co", archive: true },
  { name: "robinhood", url: "https://rpc.mainnet.chain.robinhood.com", archive: false },
  { name: "solidrpc", url: "https://rpc.solidrpc.io/public/evm/4663", archive: false },
];

const ADDRESS = /^0x[0-9a-f]{40}$/i;
const HASH = /^0x[0-9a-f]{64}$/i;
const HEX_NUMBER = /^0x[0-9a-f]+$/i;
const RPC_TIMEOUT_MS = 3_500;
const PROVIDER_REQUEST_GAP_MS = 140;
const PROVIDER_OPERATION_BUDGET_MS = 9_000;
const PROVIDER_COOLDOWN_WAIT_MS = 900;
const PROVIDER_BACKOFF_BASE_MS = 900;
const PROVIDER_BACKOFF_MAX_MS = 30_000;
const LOG_RETRY_DELAYS_MS = [260, 720] as const;

const providerHealth = new Map<string, ProviderHealth>();
const providerQueues = new Map<string, Promise<void>>();

function delay(milliseconds: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, milliseconds));
}

function parseRetryAfter(value: string | null) {
  if (!value) return undefined;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.min(PROVIDER_BACKOFF_MAX_MS, Math.ceil(seconds * 1_000));
  const at = Date.parse(value);
  return Number.isFinite(at) ? Math.min(PROVIDER_BACKOFF_MAX_MS, Math.max(0, at - Date.now())) : undefined;
}

function rpcErrorCode(error: unknown) {
  if (error instanceof PonsRpcError) return error.code;
  if (error instanceof DOMException && error.name === "TimeoutError") return "timeout";
  const message = error instanceof Error ? error.message : String(error);
  if (/abort|timeout/i.test(message)) return "timeout";
  return message.toLowerCase().replace(/[^a-z0-9-]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 96) || "network_error";
}

export function isRetryablePonsRpcError(error: unknown) {
  const code = rpcErrorCode(error);
  return code === "timeout"
    || code === "network_error"
    || /^http_(408|425|429|5\d\d)$/.test(code)
    || /^rpc_-?(32000|32005|32016|32603)$/.test(code)
    || code === "pons_rpc_backoff_active";
}

function isProviderPressure(error: unknown) {
  const code = rpcErrorCode(error);
  return code === "http_429" || code === "http_403" || code === "rpc_-32005" || code === "rpc_-32016";
}

function stateFor(provider: Provider) {
  const current = providerHealth.get(provider.url) ?? {
    consecutiveFailures: 0,
    cooldownUntil: 0,
    lastRequestAt: 0,
  };
  providerHealth.set(provider.url, current);
  return current;
}

function markProviderSuccess(provider: Provider) {
  providerHealth.set(provider.url, {
    consecutiveFailures: 0,
    cooldownUntil: 0,
    lastRequestAt: Date.now(),
  });
}

function markProviderFailure(provider: Provider, error: unknown) {
  const previous = stateFor(provider);
  const consecutiveFailures = previous.consecutiveFailures + 1;
  const suppliedDelay = error instanceof PonsRpcError ? error.retryAfterMs : undefined;
  const baseDelay = isProviderPressure(error) ? PROVIDER_BACKOFF_BASE_MS : 220;
  const cooldownMs = Math.min(
    PROVIDER_BACKOFF_MAX_MS,
    suppliedDelay ?? baseDelay * 2 ** Math.min(5, consecutiveFailures - 1),
  );
  providerHealth.set(provider.url, {
    consecutiveFailures,
    cooldownUntil: Date.now() + cooldownMs,
    lastRequestAt: previous.lastRequestAt,
  });
}

async function runWithProviderSlot<T>(provider: Provider, operation: () => Promise<T>) {
  const previous = providerQueues.get(provider.url) ?? Promise.resolve();
  let release: () => void = () => undefined;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const queued = previous.catch(() => undefined).then(() => gate);
  providerQueues.set(provider.url, queued);
  await previous.catch(() => undefined);
  try {
    const state = stateFor(provider);
    const cooldownMs = Math.max(0, state.cooldownUntil - Date.now());
    if (cooldownMs > PROVIDER_COOLDOWN_WAIT_MS) {
      throw new PonsRpcError("pons_rpc_backoff_active", "PONS RPC provider is cooling down", {
        retryAfterMs: cooldownMs,
      });
    }
    const waitMs = Math.max(cooldownMs, state.lastRequestAt + PROVIDER_REQUEST_GAP_MS - Date.now());
    if (waitMs > 0) await delay(waitMs);
    state.lastRequestAt = Date.now();
    return await operation();
  } finally {
    release();
    if (providerQueues.get(provider.url) === queued) providerQueues.delete(provider.url);
  }
}

function providers(archive = false) {
  const configured = String(getRuntimeBinding("PONS_RPC_URLS") || getRuntimeBinding("RH_RPC_URLS") || "")
    .split(",")
    .map((url) => url.trim())
    .filter(Boolean)
    .map((url, index) => ({ name: `managed-${index + 1}`, url, archive: true }));
  const unique = new Map<string, Provider>();
  for (const provider of [...configured, ...DEFAULT_PROVIDERS]) {
    if (!archive || provider.archive) unique.set(provider.url, provider);
  }
  return [...unique.values()];
}

async function postBatch(provider: Provider, requests: RpcRequest[], tolerateItemErrors = false) {
  const startedAt = Date.now();
  let response: Response;
  try {
    response = await fetch(provider.url, {
      method: "POST",
      headers: {
        accept: "application/json",
        "content-type": "application/json",
        "user-agent": "Memetic-State/1.0 PONS-evidence-indexer",
      },
      body: JSON.stringify(requests),
      signal: AbortSignal.timeout(RPC_TIMEOUT_MS),
    });
  } catch (error) {
    const code = rpcErrorCode(error);
    throw new PonsRpcError(code, error instanceof Error ? error.message : "PONS RPC request failed");
  }
  if (!response.ok) {
    throw new PonsRpcError(`http_${response.status}`, `PONS RPC returned ${response.status}`, {
      status: response.status,
      retryAfterMs: parseRetryAfter(response.headers.get("retry-after")),
    });
  }
  const payload = await response.json().catch(() => {
    throw new PonsRpcError("invalid_rpc_json", "PONS RPC returned invalid JSON");
  });
  if (!Array.isArray(payload)) throw new Error("invalid_rpc_batch");
  const envelopes = payload as RpcEnvelope[];
  if (!tolerateItemErrors) {
    const failed = envelopes.find((envelope) => envelope.error);
    if (failed?.error) {
      const code = `rpc_${failed.error.code ?? "error"}`;
      throw new PonsRpcError(code, failed.error.message ?? code);
    }
  }
  return { envelopes, latencyMs: Date.now() - startedAt };
}

async function withProvider<T>(operation: (provider: Provider) => Promise<T>, archive = false, preferredIndex = 0) {
  let lastError: unknown;
  const candidates = providers(archive);
  const ordered = candidates.map((_provider, offset) => candidates[(preferredIndex + offset) % candidates.length]);
  const attempted = new Set<string>();
  const startedAt = Date.now();
  while (attempted.size < ordered.length && Date.now() - startedAt < PROVIDER_OPERATION_BUDGET_MS) {
    const now = Date.now();
    let provider = ordered.find((candidate) => !attempted.has(candidate.url) && stateFor(candidate).cooldownUntil <= now);
    if (!provider) {
      const next = ordered
        .filter((candidate) => !attempted.has(candidate.url))
        .sort((left, right) => stateFor(left).cooldownUntil - stateFor(right).cooldownUntil)[0];
      if (!next) break;
      const waitMs = stateFor(next).cooldownUntil - now;
      if (waitMs > PROVIDER_COOLDOWN_WAIT_MS || Date.now() - startedAt + waitMs >= PROVIDER_OPERATION_BUDGET_MS) {
        lastError ??= new PonsRpcError("pons_rpc_backoff_active", "All PONS RPC providers are cooling down");
        break;
      }
      if (waitMs > 0) await delay(waitMs);
      provider = next;
    }
    attempted.add(provider.url);
    try {
      const value = await runWithProviderSlot(provider, () => operation(provider));
      markProviderSuccess(provider);
      return { value, provider };
    } catch (error) {
      lastError = error;
      if (rpcErrorCode(error) !== "pons_rpc_backoff_active") markProviderFailure(provider, error);
    }
  }
  throw lastError instanceof Error ? lastError : new PonsRpcError("pons_rpc_unavailable", "No PONS RPC provider succeeded");
}

async function withBoundedRetry<T>(operation: (attempt: number) => Promise<T>) {
  let lastError: unknown;
  for (let attempt = 0; attempt <= LOG_RETRY_DELAYS_MS.length; attempt += 1) {
    try {
      return await operation(attempt);
    } catch (error) {
      lastError = error;
      if (!isRetryablePonsRpcError(error) || attempt >= LOG_RETRY_DELAYS_MS.length) break;
      await delay(LOG_RETRY_DELAYS_MS[attempt]);
    }
  }
  throw lastError instanceof Error ? lastError : new PonsRpcError("pons_rpc_unavailable", "PONS RPC retry budget exhausted");
}

function resultMap(envelopes: RpcEnvelope[]) {
  return new Map(envelopes.map((envelope) => [envelope.id, envelope.result]));
}

function parseBlock(value: unknown) {
  if (!value || typeof value !== "object") throw new Error("invalid_block");
  const block = value as { number?: unknown; hash?: unknown; timestamp?: unknown };
  if (typeof block.number !== "string" || !HEX_NUMBER.test(block.number)
    || typeof block.hash !== "string" || !HASH.test(block.hash)
    || typeof block.timestamp !== "string" || !HEX_NUMBER.test(block.timestamp)) {
    throw new Error("invalid_block");
  }
  return {
    number: Number.parseInt(block.number.slice(2), 16),
    hash: block.hash.toLowerCase(),
    timestamp: Number.parseInt(block.timestamp.slice(2), 16),
  };
}

export async function getPonsHead() {
  const { value, provider } = await withBoundedRetry((attempt) => withProvider(async (candidate) => {
    const batch = await postBatch(candidate, [
      { jsonrpc: "2.0", id: 1, method: "eth_chainId", params: [] },
      { jsonrpc: "2.0", id: 2, method: "eth_getBlockByNumber", params: ["latest", false] },
    ]);
    const byId = resultMap(batch.envelopes);
    const chainId = byId.get(1);
    if (typeof chainId !== "string" || !HEX_NUMBER.test(chainId) || Number.parseInt(chainId.slice(2), 16) !== PONS_CHAIN_ID) {
      throw new Error("pons_chain_mismatch");
    }
    return { ...parseBlock(byId.get(2)), latencyMs: batch.latencyMs };
  }, false, attempt));
  return { ...value, provider: provider.name };
}

export async function getPonsBlock(blockNumber: number, archive = false) {
  const { value, provider } = await withBoundedRetry((attempt) => withProvider(async (candidate) => {
    const batch = await postBatch(candidate, [{
      jsonrpc: "2.0", id: 1, method: "eth_getBlockByNumber", params: [`0x${blockNumber.toString(16)}`, false],
    }]);
    return parseBlock(resultMap(batch.envelopes).get(1));
  }, archive, attempt));
  return { ...value, provider: provider.name };
}

async function requestPonsLogs(
  fromBlock: number,
  toBlock: number,
  archive: boolean,
  preferredIndex = 0,
): Promise<PonsLogBatch> {
  const { value, provider } = await withProvider(async (candidate) => {
    const batch = await postBatch(candidate, [
      {
        jsonrpc: "2.0", id: 1, method: "eth_getLogs", params: [{
          address: PONS_V2_FACTORY,
          fromBlock: `0x${fromBlock.toString(16)}`,
          toBlock: `0x${toBlock.toString(16)}`,
          topics: [[PONS_TOPICS.launch, PONS_TOPICS.swept, PONS_TOPICS.graduated, PONS_TOPICS.permanentlyLocked]],
        }],
      },
      {
        jsonrpc: "2.0", id: 2, method: "eth_getLogs", params: [{
          fromBlock: `0x${fromBlock.toString(16)}`,
          toBlock: `0x${toBlock.toString(16)}`,
          topics: [[PONS_TOPICS.curveBuy, PONS_TOPICS.curveSell]],
        }],
      },
    ]);
    const byId = resultMap(batch.envelopes);
    const factoryPayload = byId.get(1);
    const curvePayload = byId.get(2);
    if (!Array.isArray(factoryPayload) || !Array.isArray(curvePayload)) throw new Error("invalid_log_response");
    const factoryLogs = factoryPayload.filter(validRpcLog).filter((log) => !log.removed);
    const curveLogs = curvePayload.filter(validRpcLog).filter((log) => !log.removed);
    if (factoryLogs.length !== factoryPayload.length || curveLogs.length !== curvePayload.length) throw new Error("invalid_log_record");
    return { factoryLogs, curveLogs, latencyMs: batch.latencyMs };
  }, archive, preferredIndex);
  return { ...value, provider: provider.name, fromBlock, toBlock };
}

function canSplitLogRange(error: unknown) {
  const code = rpcErrorCode(error);
  return code === "timeout" || code === "http_413" || code === "http_504"
    || code === "rpc_-32005" || code === "rpc_-32016";
}

async function getPonsLogsAdaptive(
  fromBlock: number,
  toBlock: number,
  archive: boolean,
  depth = 0,
): Promise<PonsLogBatch> {
  try {
    return await withBoundedRetry((attempt) => requestPonsLogs(
      fromBlock,
      toBlock,
      archive,
      Math.floor(fromBlock / (archive ? 10_000 : 2_000)) + attempt,
    ));
  } catch (error) {
    const minimumRange = archive ? 1_000 : 250;
    const blockCount = toBlock - fromBlock + 1;
    if (!canSplitLogRange(error) || blockCount <= minimumRange || depth >= 3) throw error;
    const midpoint = fromBlock + Math.floor(blockCount / 2) - 1;
    const left = await getPonsLogsAdaptive(fromBlock, midpoint, archive, depth + 1);
    const right = await getPonsLogsAdaptive(midpoint + 1, toBlock, archive, depth + 1);
    return {
      factoryLogs: [...left.factoryLogs, ...right.factoryLogs],
      curveLogs: [...left.curveLogs, ...right.curveLogs],
      latencyMs: left.latencyMs + right.latencyMs,
      provider: [...new Set(`${left.provider}+${right.provider}`.split("+"))].join("+"),
      fromBlock,
      toBlock,
    };
  }
}

export async function getPonsLogs(fromBlock: number, toBlock: number, archive = false) {
  const maximumRange = archive ? 10_000 : 2_000;
  if (toBlock < fromBlock || toBlock - fromBlock + 1 > maximumRange) throw new Error("pons_log_range_invalid");
  return getPonsLogsAdaptive(fromBlock, toBlock, archive);
}

export async function getPonsV1LaunchLogs(
  generationId: PonsV1GenerationId,
  fromBlock: number,
  toBlock: number,
) {
  if (toBlock < fromBlock || toBlock - fromBlock + 1 > 10_000) throw new Error("pons_v1_launch_range_invalid");
  const generation = PONS_V1_GENERATIONS[generationId];
  const { value, provider } = await withProvider(async (candidate) => {
    const batch = await postBatch(candidate, [{
      jsonrpc: "2.0", id: 1, method: "eth_getLogs", params: [{
        address: generation.factory,
        fromBlock: `0x${fromBlock.toString(16)}`,
        toBlock: `0x${toBlock.toString(16)}`,
        topics: [PONS_TOPICS.v1Launch],
      }],
    }]);
    const payload = resultMap(batch.envelopes).get(1);
    if (!Array.isArray(payload)) throw new Error("invalid_v1_launch_response");
    const logs = payload.filter(validRpcLog).filter((log) => !log.removed);
    if (logs.length !== payload.length) throw new Error("invalid_v1_launch_record");
    return { logs, latencyMs: batch.latencyMs };
  }, true, Math.floor(fromBlock / 10_000));
  return { ...value, provider: provider.name, fromBlock, toBlock, generationId };
}

export async function getPonsV1SwapLogs(fromBlock: number, toBlock: number, poolAddresses: string[]) {
  if (toBlock < fromBlock || toBlock - fromBlock + 1 > 2_000) throw new Error("pons_v1_swap_range_invalid");
  const addresses = [...new Set(poolAddresses.map((address) => address.toLowerCase()))];
  if (!addresses.length) return { logs: [] as RpcLog[], provider: "none", latencyMs: 0, fromBlock, toBlock };
  const { value, provider } = await withProvider(async (candidate) => {
    const batch = await postBatch(candidate, [{
      jsonrpc: "2.0", id: 1, method: "eth_getLogs", params: [{
        address: addresses,
        fromBlock: `0x${fromBlock.toString(16)}`,
        toBlock: `0x${toBlock.toString(16)}`,
        topics: [PONS_TOPICS.v3Swap],
      }],
    }]);
    const payload = resultMap(batch.envelopes).get(1);
    if (!Array.isArray(payload)) throw new Error("invalid_v1_swap_response");
    const logs = payload.filter(validRpcLog).filter((log) => !log.removed);
    if (logs.length !== payload.length) throw new Error("invalid_v1_swap_record");
    return { logs, latencyMs: batch.latencyMs };
  }, true, Math.floor(fromBlock / 2_000));
  return { ...value, provider: provider.name, fromBlock, toBlock };
}

export async function readPonsTokenMetadata(tokens: Array<{ tokenAddress: string }>) {
  const candidates = tokens.filter((token) => ADDRESS.test(token.tokenAddress)).slice(0, 40);
  if (!candidates.length) return { records: [], provider: "none", latencyMs: 0 };
  const records: Array<{ tokenAddress: string; symbol: string | null; name: string | null; ok: boolean }> = [];
  const usedProviders = new Set<string>();
  let latencyMs = 0;

  for (let offset = 0; offset < candidates.length; offset += 20) {
    const chunk = candidates.slice(offset, offset + 20);
    const { value, provider } = await withProvider(async (candidate) => {
      const requests = chunk.flatMap((token, index): RpcRequest[] => [
        { jsonrpc: "2.0", id: 1_000 + index * 2, method: "eth_call", params: [{ to: token.tokenAddress, data: "0x95d89b41" }, "latest"] },
        { jsonrpc: "2.0", id: 1_001 + index * 2, method: "eth_call", params: [{ to: token.tokenAddress, data: "0x06fdde03" }, "latest"] },
      ]);
      const batch = await postBatch(candidate, requests, true);
      const byId = new Map(batch.envelopes.map((envelope) => [envelope.id, envelope]));
      return {
        latencyMs: batch.latencyMs,
        records: chunk.map((token, index) => {
          const symbolEnvelope = byId.get(1_000 + index * 2);
          const nameEnvelope = byId.get(1_001 + index * 2);
          const symbol = typeof symbolEnvelope?.result === "string" ? decodeAbiString(symbolEnvelope.result) : null;
          const name = typeof nameEnvelope?.result === "string" ? decodeAbiString(nameEnvelope.result) : null;
          return { tokenAddress: token.tokenAddress.toLowerCase(), symbol, name, ok: Boolean(symbol && name) };
        }),
      };
    });
    usedProviders.add(provider.name);
    latencyMs += value.latencyMs;
    records.push(...value.records);
  }

  return { records, provider: [...usedProviders].join("+") || "none", latencyMs };
}

export function rpcLogTimestamp(log: RpcLog, fallbackSeconds: number) {
  return log.blockTimestamp && HEX_NUMBER.test(log.blockTimestamp)
    ? Number.parseInt(log.blockTimestamp.slice(2), 16)
    : fallbackSeconds;
}
