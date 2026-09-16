import type { TokenSearchResult } from "@/lib/tokens/model";
import type { ResearchDossier } from "@/lib/premium/research";
import type { RecentCurveResult } from "@/lib/premium/recent-curve";
import { compareSources, failureCode, type ResearchReport, type ResearchTask } from "./model";
import { boundedRead, curveSource, holderSource, indexedSource, marketSource, unavailableSource } from "./sources";
import { runResearchAgent, runResearchSynthesis, type researchModelConfig } from "./agent";
import { previousThesis, reviewResearch } from "./review";

export async function investigate(task: ResearchTask, previous: ResearchReport | null, services: {
  lookup: (token: string) => Promise<TokenSearchResult | null>;
  dossier: (token: string) => Promise<ResearchDossier | null>;
  recent: (token: string) => Promise<RecentCurveResult>;
  config: ReturnType<typeof researchModelConfig>; deadline: number; fetcher?: typeof fetch;
}): Promise<ResearchReport> {
  const baselineDeadline = Math.min(Date.now() + 8_000, services.deadline - 2_000);
  const [identity, indexed] = await Promise.allSettled([
    boundedRead(services.lookup(task.tokenAddress), baselineDeadline),
    boundedRead(services.dossier(task.tokenAddress), baselineDeadline),
  ]);
  const token = identity.status === "fulfilled" ? identity.value : null;
  const dossier = indexed.status === "fulfilled" ? indexed.value : null;
  const sources = [marketSource(task.tokenAddress, token), indexedSource(task.tokenAddress, dossier)];
  const steps: ResearchReport["steps"] = sources.map(s => ({ tool: s.label, status: s.freshness === "unavailable" ? "unavailable" : "complete", note: s.freshness === "unavailable" ? s.limitations[0] : `Collected ${s.freshness} evidence.` }));
  async function read(name: string) {
    let source;
    if (name === "inspect_holder_snapshot") source = holderSource(task.tokenAddress, dossier);
    else if (name === "inspect_recent_curve") {
      try {
        const result = token?.graduated ? null : await boundedRead(services.recent(task.tokenAddress), Math.min(Date.now() + 5_000, services.deadline - 1_000));
        source = curveSource(task.tokenAddress, result?.check ?? null, token?.graduated === true);
      } catch { source = unavailableSource("curve", task.tokenAddress, "The recent curve check was unavailable or exceeded its time budget. This does not establish zero activity."); }
    } else throw new Error("unknown_research_tool");
    sources.push(source);
    steps.push({ tool: source.label, status: source.freshness === "unavailable" ? "unavailable" : "complete", note: source.freshness === "unavailable" ? source.limitations[0] : `Collected ${source.freshness} evidence.` });
    return source;
  }
  let analysis: ResearchReport["analysis"] = null;
  let analysisStatus: ResearchReport["analysisStatus"] = services.config ? "unavailable" : "not_configured";
  let thesis = previousThesis(task, previous);
  let reviewStatus: ResearchReport["reviewStatus"] = services.config ? "unavailable" : "not_configured";
  if (services.config) {
    let aiStage = "draft";
    const repairBudget = { remaining: 1 };
    try {
      // Reserve part of the existing total budget for one review. No debate loop.
      if (services.config.runtime === "single-pass") {
        await read("inspect_holder_snapshot");
        await read("inspect_recent_curve");
      }

      const draft = services.config.runtime === "single-pass"
        ? await runResearchSynthesis({
            config: services.config,
            task,
            sources,
            changes: compareSources(previous, sources),
            deadline: services.deadline - 20_000,
            fetcher: services.fetcher,
            repairBudget,
          })
        : await runResearchAgent({
            config: services.config,
            task,
            sources,
            changes: compareSources(previous, sources),
            read,
            deadline: services.deadline - 12_000,
            fetcher: services.fetcher,
            repairBudget,
          });
      steps.push({ tool: "Researcher", status: "complete", note: "Prepared a provisional reading for review." });

      aiStage = "review";
      const reviewed = await reviewResearch({ config: services.config, task, draft, sources, previous: thesis, deadline: services.deadline, fetcher: services.fetcher, repairBudget });
      analysis = reviewed.analysis; thesis = reviewed.thesis; reviewStatus = "complete";
      steps.push({ tool: "Skeptic & editor", status: "complete", note: "Checked the draft against its evidence and saved one reviewed thesis." });
      analysisStatus = "complete";
    } catch (error) {
      const code = failureCode(error, "analysis_unavailable");
      console.error("research AI stage failed", { stage: aiStage, code });
      steps.push({ tool: aiStage === "draft" ? "Researcher" : "Skeptic & editor", status: "unavailable", code,
        note: "A reviewed conclusion could not be completed. Earlier thesis memory retains its original date and evidence." });
      // Do not publish an unchecked draft or overwrite the previous reviewed thesis.
    }
  } else await read(task.focus === "risk" || task.focus === "thesis" ? "inspect_holder_snapshot" : "inspect_recent_curve");
  return { version: "researcher-v1", tokenAddress: task.tokenAddress, name: token?.name ?? dossier?.token.name ?? null, symbol: token?.symbol ?? dossier?.token.symbol ?? null,
    question: task.question, generatedAt: new Date().toISOString(), mode: analysis ? "ai" : "evidence", analysis, analysisStatus,
    sources, changes: compareSources(previous, sources), thesis, reviewStatus, steps };
}
