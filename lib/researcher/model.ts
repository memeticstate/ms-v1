export const RESEARCH_FOCUSES = ["overview", "participation", "risk", "thesis"] as const;
export type ResearchFocus = typeof RESEARCH_FOCUSES[number];
export type ResearchCadence = "manual" | "hourly" | "daily";
export type ResearchTask = {
  id: string; tokenAddress: string; question: string; focus: ResearchFocus;
  cadence: ResearchCadence; paused: boolean; createdAt: number; updatedAt: number;
  nextRunAt: number | null; lastRunAt: number | null;
};
export type ResearchSource = {
  id: string; label: string; url: string; fetchedAt: string;
  evidenceAt: string | null; freshness: "recent" | "historical" | "unavailable";
  facts: string[]; limitations: string[]; metrics: Record<string, number | string | null>;
};
export type ResearchFinding = { claim: string; sourceIds: string[] };
export type ResearchAnalysis = { answer: string; findings: ResearchFinding[]; unknowns: string[]; nextChecks: string[] };
export type ResearchThesis = {
  statement: string; verdict: "supported" | "challenged" | "unresolved";
  support: ResearchFinding[]; challenges: ResearchFinding[];
  unknowns: string[]; invalidationConditions: string[]; nextChecks: string[];
  change: "baseline" | "strengthened" | "weakened" | "unchanged" | "unresolved";
  changeReason: string; reviewNotes: { issue: string; resolution: string }[];
  reviewedAt: string; priorReviewedAt: string | null;
  // Keep the evidence attached to its review, including when carried forward.
  sources: ResearchSource[];
};
export type ResearchReport = {
  version: "researcher-v1"; tokenAddress: string; name: string | null; symbol: string | null;
  question: string; generatedAt: string; mode: "ai" | "evidence";
  analysis: ResearchAnalysis | null; analysisStatus: "complete" | "not_configured" | "unavailable";
  sources: ResearchSource[]; changes: string[];
  thesis?: ResearchThesis | null;
  reviewStatus?: "complete" | "not_configured" | "unavailable";
  steps: { tool: string; status: "complete" | "unavailable"; note: string }[];
};
export type ResearchRun = {
  id: string; assignmentId: string; status: "queued" | "running" | "complete" | "partial" | "failed" | "blocked";
  requestedAt: number; finishedAt: number | null; error: string | null; report: ResearchReport | null;
};
export const RESEARCH_LIMITS = { assignments: 5, dailyPerHolder: 12, dailySite: 100, cooldownMs: 60_000, maxQuestion: 1200 };
export function cadenceMs(cadence: ResearchCadence) { return cadence === "hourly" ? 3_600_000 : cadence === "daily" ? 86_400_000 : null; }
export function validTaskInput(value: unknown) {
  if (!value || typeof value !== "object") throw new Error("invalid_assignment");
  const input = value as Record<string, unknown>;
  const tokenAddress = typeof input.tokenAddress === "string" ? input.tokenAddress.trim().toLowerCase() : "";
  const question = typeof input.question === "string" ? input.question.trim() : "";
  if (!/^0x[0-9a-f]{40}$/.test(tokenAddress) || question.length < 8 || question.length > RESEARCH_LIMITS.maxQuestion
    || /[\u0000-\u0008\u000B\u000C\u000E-\u001F]/.test(question)
    || !RESEARCH_FOCUSES.includes(input.focus as ResearchFocus) || !["manual", "hourly", "daily"].includes(String(input.cadence))) throw new Error("invalid_assignment");
  return { tokenAddress, question, focus: input.focus as ResearchFocus, cadence: input.cadence as ResearchCadence };
}

export function compareSources(previous: ResearchReport | null, sources: ResearchSource[]): string[] {
  if (!previous) return ["First observation saved. A later check can establish what changed."];
  const changes: string[] = [];
  for (const source of sources) {
    const before = previous.sources.find(item => item.id === source.id);
    if (source.freshness === "unavailable") { changes.push(`${source.label}: this check could not refresh.`); continue; }
    if (!before || before.freshness === "unavailable") { changes.push(`${source.label}: a first usable observation is now available.`); continue; }
    if (source.freshness !== before.freshness) changes.push(`${source.label}: evidence is now ${source.freshness}.`);
    const oldBlock = before.metrics.throughBlock, newBlock = source.metrics.throughBlock;
    if (typeof oldBlock === "number" && typeof newBlock === "number" && newBlock <= oldBlock) {
      changes.push(`${source.label}: no newer evidence window; this does not establish unchanged market activity.`); continue;
    }
    if (typeof newBlock !== "number" && (!source.evidenceAt || !before.evidenceAt || Date.parse(source.evidenceAt) <= Date.parse(before.evidenceAt))) {
      changes.push(`${source.label}: no newer dated observation is available for comparison.`); continue;
    }
    if (source.freshness !== before.freshness) continue;
    for (const key of ["marketCapUsd", "volume24hUsd", "trades", "actors", "holderCount"] as const) {
      const oldValue = before.metrics[key], newValue = source.metrics[key];
      if (typeof oldValue !== "number" || typeof newValue !== "number" || oldValue === newValue) continue;
      if (source.metrics.windowBlocks !== before.metrics.windowBlocks) continue;
      const title = { marketCapUsd: "reported market cap", volume24hUsd: "reported 24h volume", trades: "trades in the observed window", actors: "wallet addresses in the observed window", holderCount: "reported holder count" }[key];
      changes.push(`${source.label}: ${title} changed from ${oldValue.toLocaleString("en-US", { maximumFractionDigits: 2 })} to ${newValue.toLocaleString("en-US", { maximumFractionDigits: 2 })}.`);
    }
  }
  return changes.length ? changes.slice(0, 8) : ["No measurable difference in the comparable observations returned. Coverage limits still apply."];
}
