import { decodeAbiParameters, encodeFunctionData, parseAbi } from "viem";
import { getRuntimeBinding } from "@/db";
import { acquireAuxJob, recentTokenActors, releaseAuxJob, researchCandidate, storeTokenEvidence } from "@/db/pons-research";
import { pendingPonsMetadata, updatePonsMetadata } from "@/db/pons-ledger";
import { getPonsHead, readPonsContracts, readPonsTokenMetadata } from "./pons-rpc";
import { decodeAbiString } from "@/lib/pons/decode";
import type { PonsTokenEvidence } from "@/lib/pons/model";
import type { RpcRequest } from "./rpc-transport";

const ABI = parseAbi([
  "function name() view returns (string)", "function symbol() view returns (string)",
  "function totalSupply() view returns (uint256)", "function liquidityPool() view returns (address)",
  "function socials() view returns (string,string,string,string,string)",
  "function balanceOf(address) view returns (uint256)",
]);
const ADDRESS = /^0x[0-9a-f]{40}$/i;
const ZERO = "0x0000000000000000000000000000000000000000";
const BURN = "0x000000000000000000000000000000000000dead";
const HOLDER_RPC_CHUNK_REQUESTS = 24;
function raw(value: unknown) { try { return typeof value === "string" && /^0x[0-9a-f]+$/i.test(value) ? BigInt(value) : null; } catch { return null; } }
function percent(value: bigint, supply: bigint) { return Number(value * 1_000_000n / supply) / 10_000; }
function text(value: unknown) { return typeof value === "string" ? decodeAbiString(value)?.replace(/[\u0000-\u001f\u007f\u200b-\u200f\u202a-\u202e\u2066-\u2069]/g, "").trim().slice(0, 96) || null : null; }
function socialUrl(value: unknown) {
  try {
    if (typeof value !== "string") return null;
    const [twitter] = decodeAbiParameters([{ type: "string" }, { type: "string" }, { type: "string" }, { type: "string" }, { type: "string" }], value as `0x${string}`);
    const url = new URL(twitter);
    return url.protocol === "https:" && ["x.com", "twitter.com", "www.x.com", "www.twitter.com"].includes(url.hostname) && /^\/[a-zA-Z0-9_]{1,15}\/?$/.test(url.pathname)
      ? `https://x.com/${url.pathname.split("/")[1]}` : null;
  } catch { return null; }
}

async function socialEvidence(token: string, twitterUrl: string | null): Promise<PonsTokenEvidence["social"]> {
  const bearer = getRuntimeBinding("X_BEARER_TOKEN");
  if (typeof bearer !== "string" || !bearer) return { status: "unconfigured", mentions: null, authors: null, latestPostAt: null, posts: [] };
  const handle = twitterUrl?.split("/").pop();
  const url = new URL("https://api.x.com/2/tweets/search/recent");
  // A bounded sample of exact-address mentions and registered-account posts. Never treated as organic reach.
  url.searchParams.set("query", `("${token}"${handle ? ` OR from:${handle}` : ""}) -is:retweet`);
  url.searchParams.set("max_results", "10");
  url.searchParams.set("tweet.fields", "created_at,author_id");
  url.searchParams.set("start_time", new Date(Date.now() - 24 * 60 * 60_000).toISOString());
  try {
    const response = await fetch(url, { headers: { Authorization: `Bearer ${bearer}` }, signal: AbortSignal.timeout(2500) });
    if (!response.ok) {
      try {
        await response.body?.cancel();
      } catch {
        // Body cleanup is best effort; the social source remains unavailable.
      }
      throw new Error("social_unavailable");
    }
    const body = await response.json() as { data?: Array<{ id: string; author_id: string; created_at: string }> };
    const posts = (body.data ?? []).filter((p) => /^\d+$/.test(p.id) && Number.isFinite(Date.parse(p.created_at))).slice(0, 10);
    return { status: "ok", mentions: posts.length, authors: new Set(posts.map((p) => p.author_id)).size,
      latestPostAt: posts.map((p) => p.created_at).sort().at(-1) ?? null,
      posts: posts.map((p) => ({ url: `https://x.com/i/web/status/${p.id}`, createdAt: p.created_at })) };
  } catch { return { status: "unavailable", mentions: null, authors: null, latestPostAt: null, posts: [] }; }
}

export async function runTokenResearch(
  token?: string,
  options: { intervalMs?: number } = {},
) {
  if (token && !ADDRESS.test(token)) return { status: "rejected", reason: "invalid_address" };
  if (!await acquireAuxJob("token-research", options.intervalMs ?? 5_000)) {
    return { status: "skipped", reason: "research_cooldown" };
  }
  try {
    const candidate = await researchCandidate(token?.toLowerCase());
    if (!candidate) return { status: "skipped", reason: "already_fresh_or_not_indexed" };
    const startedAt = Date.now(), address = candidate.token_address as `0x${string}`;
    const evidence: PonsTokenEvidence = {
      tokenAddress: address, checkedAt: new Date().toISOString(), observedAt: null, blockNumber: null,
      status: "unavailable", symbol: null, name: null, totalSupplyRaw: null, reserveSharePercent: null,
      deployerSharePercent: null, holderCount: null, meaningfulHolders: null, largestWalletSharePercent: null,
      holderSampleSize: 0, holdersComplete: false, sampleBasis: "indexed-actors", poolAddress: null, twitterUrl: null,
      social: { status: "unconfigured", mentions: null, authors: null, latestPostAt: null, posts: [] },
      sources: [`https://robinhoodchain.blockscout.com/token/${address}`], errors: [],
    };
    try {
      const head = await getPonsHead();
      const block = `0x${head.number.toString(16)}`;
      const methods = ["name", "symbol", "totalSupply", "liquidityPool", "socials"] as const;
      const metadata = await readPonsContracts(methods.map((method, id): RpcRequest => ({ jsonrpc: "2.0", id, method: "eth_call", params: [{ to: address, data: encodeFunctionData({ abi: ABI, functionName: method }) }, block] })));
      const values = new Map(metadata.envelopes.filter((r) => !r.error).map((r) => [r.id, r.result]));
      evidence.name = text(values.get(0)); evidence.symbol = text(values.get(1));
      evidence.twitterUrl = socialUrl(values.get(4));
      const supply = raw(values.get(2));
      const poolRaw = values.get(3);
      const pool = typeof poolRaw === "string" && /^0x[0-9a-f]{64}$/i.test(poolRaw) ? `0x${poolRaw.slice(-40)}`.toLowerCase() : null;
      evidence.poolAddress = pool && pool !== ZERO ? pool : null;
      await updatePonsMetadata([{ tokenAddress: address, name: evidence.name, symbol: evidence.symbol, ok: Boolean(evidence.name && evidence.symbol) }]);
      if (!supply || supply <= 0n) throw new Error("supply_unavailable");
      evidence.totalSupplyRaw = supply.toString();
      if (Date.now() - startedAt > 13_000) throw new Error("holder_budget_deferred");
      const actors = await recentTokenActors(address);
      const reserves = [...new Set([candidate.curve_address, evidence.poolAddress].filter((v): v is string => Boolean(v) && v !== ZERO))];
      const wallets = [...new Set([...reserves, candidate.deployer_address, ...actors])].filter((v) => ADDRESS.test(v) && ![ZERO, BURN].includes(v.toLowerCase()));
      const requests = wallets.flatMap((wallet, i): RpcRequest[] => [
        { jsonrpc: "2.0", id: i * 2, method: "eth_call", params: [{ to: address, data: encodeFunctionData({ abi: ABI, functionName: "balanceOf", args: [wallet as `0x${string}`] }) }, block] },
        { jsonrpc: "2.0", id: i * 2 + 1, method: "eth_getCode", params: [wallet, block] },
      ]);
      const holderDeadline = startedAt + 20_000;
      const holderEnvelopes = [];
      let holderRequestsProcessed = 0;

      for (let offset = 0; offset < requests.length; offset += HOLDER_RPC_CHUNK_REQUESTS) {
        if (Date.now() >= holderDeadline) {
          evidence.errors.push("holder_sample_budget_exhausted");
          break;
        }

        const chunk = requests.slice(offset, offset + HOLDER_RPC_CHUNK_REQUESTS);
        try {
          const balances = await readPonsContracts(chunk, holderDeadline);
          holderEnvelopes.push(...balances.envelopes);
          holderRequestsProcessed += chunk.length;
        } catch (error) {
          evidence.errors.push(
            error instanceof Error
              ? `holder_chunk_${error.message.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 60)}`
              : "holder_chunk_unavailable"
          );
          break;
        }
      }

      if (holderRequestsProcessed < requests.length
        && !evidence.errors.includes("holder_sample_budget_exhausted")) {
        evidence.errors.push("holder_sample_partial");
      }

      const mapped = new Map(
        holderEnvelopes.filter((r) => !r.error).map((r) => [r.id, r.result])
      );
      let reserve = 0n, completeReserves = true;
      const shares: number[] = [];
      wallets.forEach((wallet, i) => {
        const balance = raw(mapped.get(i * 2));
        if (reserves.includes(wallet)) { if (balance !== null) reserve += balance; else completeReserves = false; }
        if (balance !== null && wallet === candidate.deployer_address) evidence.deployerSharePercent = percent(balance, supply);
        if (balance !== null && mapped.get(i * 2 + 1) === "0x" && !reserves.includes(wallet)) shares.push(percent(balance, supply));
      });
      evidence.reserveSharePercent = completeReserves && reserve <= supply ? percent(reserve, supply) : null;
      evidence.holderSampleSize = shares.length;
      evidence.meaningfulHolders = shares.length ? shares.filter((p) => p >= 0.01).length : null;
      evidence.largestWalletSharePercent = shares.length ? Math.max(...shares) : null;
      evidence.observedAt = new Date(head.timestamp * 1000).toISOString();
      evidence.blockNumber = head.number;
      evidence.status = shares.length ? "partial" : "unavailable";
      if (shares.length < actors.length) evidence.errors.push("some_wallet_reads_unavailable_or_contracts");
      if (Date.now() - startedAt < 23_000) evidence.social = await socialEvidence(address, evidence.twitterUrl);
    } catch (error) {
      evidence.errors.push(error instanceof Error ? error.message.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 80) : "evidence_unavailable");
    }
    await storeTokenEvidence(evidence);
    return { status: "recorded", tokenAddress: address, evidence };
  } finally { await releaseAuxJob("token-research"); }
}

export async function runMetadataCollection() {
  if (!await acquireAuxJob("token-metadata", 30_000)) return { status: "skipped" };
  try {
    const pending = await pendingPonsMetadata(4);
    let resolved = 0;
    try {
      const metadata = await readPonsTokenMetadata(pending);
      await updatePonsMetadata(metadata.records);
      resolved = metadata.records.filter((r) => r.ok).length;
    } catch { /* An RPC outage does not prevent the public catalog fallback. */ }
    if (resolved < pending.length) {
      const { searchTokens } = await import("@/lib/tokens/discovery");
      await Promise.allSettled(pending.slice(0, 2).map(item => searchTokens(item.tokenAddress)));
    }
    return { status: "recorded", resolved };
  } finally { await releaseAuxJob("token-metadata"); }
}
