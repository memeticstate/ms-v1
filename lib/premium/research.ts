import type { PonsLaunchView, PonsTokenEvidence } from "@/lib/pons/model";
import { RESEARCH_WINDOW_OPTIONS, type ResearchSelection, type ResearchEcology, type ResearchPrompt, type InvalidationPath } from "./workflow";

export const HISTORY_PAGE_SIZE = 100;
export const COMPARISON_WINDOW_BLOCKS = 25_000;
export const COMPARISON_SAMPLE_LIMIT = 5_000;
export const EXPLORER = "https://robinhoodchain.blockscout.com";

export type EvidenceRecord = {
  id: string;
  kind: string;
  blockNumber: number;
  logIndex: number;
  observedAt: string;
  indexedAt: string;
  transaction: string;
  sourceUrl: string;
  actor: string | null;
  quoteAmountRaw: string | null;
  tokenAmountRaw: string | null;
};

export type ResearchWindow = {
  label: string;
  fromBlock: number;
  toBlock: number;
  trades: number;
  actors: number;
  buys: number;
  sells: number;
  sampled: boolean;
  firstTradeAt: string | null;
  lastTradeAt: string | null;
};

export type ResearchDossier = {
  version: "field-operator-v1" | "field-operator-v2";
  generatedAt: string;
  token: { address: string; name: string; symbol: string; curveAddress: string; creator: string; quoteAddress: string; quoteSymbol: string; quoteDecimals: number; launchedAt: string; launchTransaction: string };
  coverage: { source: string; throughBlock: number; latestObservedBlock: number; lagBlocks: number; lastCollectedAt: string | null; current: boolean; historyComplete: false; earliestIndexedTradeAt: string | null; limitation: string };
  note: { label: string; interpretation: string; observed: string[]; missing: string[]; invalidation: string[]; next: string; method: string };
  holderEvidence: PonsTokenEvidence | null;
  windows: ResearchWindow[];
  selection: ResearchSelection;
  ecology: ResearchEcology;
  prompts: ResearchPrompt[];
  invalidationPaths: InvalidationPath[];
  history: { records: EvidenceRecord[]; nextCursor: string | null; throughBlock: number; pageCursor: string | null };
};

export function parseResearchRequest(url: URL) {
  const token = (url.searchParams.get("token") ?? "").trim().toLowerCase();
  if (!/^0x[0-9a-f]{40}$/.test(token)) throw new Error("invalid_token");
  const rawCursor = url.searchParams.get("cursor");
  let cursor: { block: number; log: number } | null = null;
  if (rawCursor) {
    if (!/^\d{1,15}:\d{1,9}$/.test(rawCursor)) throw new Error("invalid_cursor");
    const [block, log] = rawCursor.split(":").map(Number);
    if (!Number.isSafeInteger(block) || !Number.isSafeInteger(log)) throw new Error("invalid_cursor");
    cursor = { block, log };
  }
  const rawThrough = url.searchParams.get("through");
  const through = rawThrough === null ? null : Number(rawThrough);
  if (through !== null && (!/^\d{1,15}$/.test(rawThrough!) || !Number.isSafeInteger(through))) throw new Error("invalid_window");
  if (cursor && through === null) throw new Error("history_anchor_required");
  const windowBlocks = Number(url.searchParams.get("window") ?? COMPARISON_WINDOW_BLOCKS);
  if (!(RESEARCH_WINDOW_OPTIONS as readonly number[]).includes(windowBlocks)) throw new Error("invalid_window_size");
  const kind = url.searchParams.get("kind") ?? "all";
  const scope = url.searchParams.get("scope") ?? "all";
  if (!["all", "buy", "sell", "lifecycle"].includes(kind) || !["all", "window"].includes(scope)) throw new Error("invalid_history_filter");
  return { token, cursor, through, windowBlocks, kind: kind as ResearchSelection["kind"], scope: scope as ResearchSelection["scope"] };
}

export function pageEvidence(records: EvidenceRecord[]) {
  const unique = new Map(records.map((row) => [`${row.transaction.toLowerCase()}:${row.logIndex}`, row]));
  const sorted = [...unique.values()].sort((a, b) => b.blockNumber - a.blockNumber || b.logIndex - a.logIndex);
  const page = sorted.slice(0, HISTORY_PAGE_SIZE);
  const last = page.at(-1);
  return { records: page, nextCursor: sorted.length > HISTORY_PAGE_SIZE && last ? `${last.blockNumber}:${last.logIndex}` : null };
}

export function researchNote(launch: PonsLaunchView, windows: ResearchWindow[], current: boolean): ResearchDossier["note"] {
  const reading = launch.research;
  const evidence = launch.currentEvidence;
  const missing = [
    "Complete holder retention and independent-human counts are not established by wallet activity.",
    "Social reach and cultural resonance are not measured by this curve-trade index.",
    "Mature-pool trading after graduation is outside this PONS V2 curve evidence view.",
    ...(!current ? ["This index is delayed or incomplete; the reading describes its recorded window."] : []),
    ...(!evidence?.observedAt ? ["A current holder observation is unavailable."] : []),
    ...(!evidence?.holdersComplete ? ["Holder evidence is a sample, not a complete distribution."] : []),
    ...(windows.some((window) => window.sampled) ? [`At least one comparison is capped at ${COMPARISON_SAMPLE_LIMIT.toLocaleString()} recent records; totals are sampled.`] : []),
  ];
  return {
    label: current ? reading?.label ?? "Evidence still forming" : "Historical research window",
    interpretation: current
      ? reading?.reasons.join(" ") || "The available observations do not yet support a stronger participation reading."
      : "Use these records to study an earlier state. Freshness constraints prevent a claim about participation now.",
    observed: windows.map((window) => `${window.label}: ${window.trades.toLocaleString()} ${window.sampled ? "sampled " : "indexed "}trades across ${window.actors.toLocaleString()} wallet addresses, blocks ${window.fromBlock.toLocaleString()}–${window.toBlock.toLocaleString()}.`),
    missing,
    invalidation: [
      "An expanding-participation reading weakens if the next comparable window loses wallet breadth or trade persistence.",
      "A fresh depleted-holder observation or deteriorating liquidity overrides historical activity as evidence of continuing participation.",
      "Missing ranges, unreconciled totals, or a stale holder sample prevent upgrading the interpretation.",
    ],
    next: current ? reading?.next ?? "Compare another recorded window and inspect holder distribution." : "Check the present pool and holder distribution, then compare a newly collected window before forming a current view.",
    method: "PONS evidence policy v4; deterministic research note from indexed events and dated holder observations.",
  };
}
