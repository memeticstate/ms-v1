export type RpcRequest = { jsonrpc: "2.0"; id: number; method: string; params: unknown[] };
type Envelope = { id: number; result?: unknown; error?: { code?: number; message?: string } };
const singleOnly = new Set<string>();

// Some public endpoints reject JSON-RPC arrays, even arrays of one request.
// Negotiate that capability once per isolate and preserve request IDs.
export async function rpcEnvelopes(url: string, requests: RpcRequest[], timeoutMs = 3500, absoluteDeadline = Infinity): Promise<Envelope[]> {
  const deadline = Math.min(absoluteDeadline, Date.now() + Math.min(8500, timeoutMs * 2));
  const send = async (payload: RpcRequest | RpcRequest[]) => {
    if (Date.now() >= deadline) throw new Error("rpc_budget_exhausted");
    const response = await fetch(url, { method: "POST", headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify(payload), signal: AbortSignal.timeout(Math.max(1, Math.min(timeoutMs, deadline - Date.now()))) });
    if (!response.ok) {
      // Do not leave error bodies unread in the Worker connection pool.
      try {
        await response.body?.cancel();
      } catch {
        // Body cleanup is best effort; preserve the upstream status below.
      }
      const error = new Error(`http_${response.status}`) as Error & { retryAfterMs?: number };
      const seconds = Number(response.headers.get("retry-after"));
      if (Number.isFinite(seconds) && seconds > 0) error.retryAfterMs = Math.min(60_000, seconds * 1000);
      throw error;
    }
    return response.json();
  };
  const singles = async () => {
    const output: Envelope[] = [];
    for (let offset = 0; offset < requests.length; offset += 3) {
      output.push(...await Promise.all(requests.slice(offset, offset + 3).map(async (request) => {
        const item = await send(request) as Envelope;
        if (!item || item.id !== request.id) throw new Error("invalid_rpc_id");
        return item;
      })));
    }
    return output;
  };
  if (singleOnly.has(url) || requests.length === 1) return singles();
  const payload = await send(requests);
  const envelopes = Array.isArray(payload) ? payload : [payload];
  if (envelopes.some((item) => item?.error && /batch.*(not support|not allow|disabled)|does not support.*batch/i.test(item.error.message ?? ""))) {
    singleOnly.add(url);
    return singles();
  }
  if (!Array.isArray(payload)) {
    if (payload?.error) throw new Error(`rpc_${payload.error.code ?? "error"}`);
    throw new Error("invalid_rpc_batch");
  }
  const ids = new Set(envelopes.map((item) => item?.id));
  if (ids.size !== requests.length || requests.some((r) => !ids.has(r.id))) throw new Error("invalid_rpc_ids");
  return envelopes;
}
