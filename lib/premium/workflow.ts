import type { ResearchDossier, ResearchWindow } from "./research";

export const RESEARCH_WINDOW_OPTIONS = [5_000, 25_000, 100_000] as const;
export type ResearchSelection = { windowBlocks: number; kind: "all" | "buy" | "sell" | "lifecycle"; scope: "all" | "window" };
export type EcologySource = { id: string; label: string; status: "recorded" | "missing"; observedAt: string | null; relationship: string; detail: string; url: string; stale: boolean };
export type EcologyPeer = { address: string; symbol: string; source: string; relationship: string; observedAt: string; url: string };
export type ResearchEcology = { sources: EcologySource[]; peers: EcologyPeer[]; quote: { symbol: string; observedAt: string; mid: number; halted: boolean } | null; limitation: string };
export type ResearchPrompt = { id: string; question: string; basis: string; next: string; url: string };
export type InvalidationPath = { id: string; title: string; status: "review" | "unresolved" | "not-flagged"; basis: string; next: string };

export function compareResearchWindows(windows: ResearchWindow[]) {
  const [latest, previous] = windows;
  if (!latest || !previous || latest.sampled || previous.sampled || previous.trades === 0) return null;
  return { trades: latest.trades - previous.trades, wallets: latest.actors - previous.actors };
}

export function researchWorkflow(data: Pick<ResearchDossier, "token" | "windows" | "coverage" | "holderEvidence">) {
  const [latest, previous] = data.windows;
  const comparison = compareResearchWindows(data.windows);
  const holder = data.holderEvidence;
  const explorer = `https://robinhoodchain.blockscout.com/token/${data.token.address}`;
  const invalidationPaths: InvalidationPath[] = [
    { id: "freshness", title: "Can this describe participation now?", status: data.coverage.current ? "not-flagged" : "unresolved",
      basis: `${data.coverage.lagBlocks.toLocaleString()} blocks behind the observed head. Collection gaps remain possible.`,
      next: "Check current pool and holder evidence. Revisit this case after the evidence block advances." },
    { id: "breadth", title: "Did recorded wallet breadth weaken?", status: comparison === null ? "unresolved" : comparison.wallets < 0 ? "review" : "not-flagged",
      basis: comparison === null ? "A capped sample or an empty prior window prevents this comparison." : `${previous.actors} → ${latest.actors} wallet addresses in equal block windows. This compares indexed activity, not independent people.`,
      next: "Inspect the buy and sell records for each window. Check whether fewer wallets account for the activity." },
    { id: "persistence", title: "Did recorded activity lose persistence?", status: comparison === null ? "unresolved" : comparison.trades < 0 ? "review" : "not-flagged",
      basis: comparison === null ? "Comparable uncapped records are not available." : `${previous.trades} → ${latest.trades} indexed trades. Missing records can affect this change.`,
      next: "Review another equal window and its source transactions before interpreting the decline." },
    { id: "retention", title: "Does holder evidence support the thesis?", status: !holder?.observedAt || !holder.holdersComplete ? "unresolved" : "not-flagged",
      basis: holder?.observedAt ? `${holder.holderSampleSize} wallets sampled at ${holder.observedAt}; ${holder.holdersComplete ? "the returned distribution is complete" : "the returned distribution is partial"}. This is not a retention series.` : "No dated holder sample is available.",
      next: "Compare a later holder observation and reserve distribution with the saved case. A single sample cannot establish retention." },
  ];
  const prompts: ResearchPrompt[] = [
    { id: "breadth", question: "Is activity spreading across wallets or being repeated by the same actors?", basis: latest ? `${latest.actors} wallet addresses across ${latest.trades} ${latest.sampled ? "sampled" : "indexed"} trades in the selected window.` : "No selected-window sample is available.", next: "Compare wallet breadth, then inspect individual transactions and the holder sample.", url: explorer },
    { id: "habitat", question: `Is the ${data.token.quoteSymbol} connection specific to this launch?`, basis: `The launch records quote asset ${data.token.quoteAddress}.`, next: "Compare PONS launches using that exact quote contract. The separately dated PAIR API sample offers habitat context only; shared labels do not establish shared liquidity.", url: `https://robinhoodchain.blockscout.com/address/${data.token.quoteAddress}` },
    { id: "falsify", question: "What observable change would make you abandon this interpretation?", basis: "Record your own invalidation condition before reviewing another window.", next: "Save a case with the evidence anchor, then compare a later observation and record the outcome.", url: explorer },
  ];
  return { prompts, invalidationPaths };
}
