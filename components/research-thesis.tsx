"use client";

import type { ResearchFinding, ResearchReport, ResearchThesis } from "@/lib/researcher/model";

const date = (value: string) => new Date(value).toLocaleString(undefined, { timeZoneName: "short" });
const verdicts = { supported: "Provisionally supported", challenged: "Challenged by evidence", unresolved: "Needs more evidence" };
const changes = { baseline: "First reviewed reading", strengthened: "Evidence strengthened", weakened: "Evidence weakened", unchanged: "No change in the comparable evidence", unresolved: "Change unresolved" };

function Findings({ title, items, thesis, empty }: { title: string; items: ResearchFinding[]; thesis: ResearchThesis; empty: string }) {
  return <section><h5 className="text-base font-semibold">{title}</h5>{items.length ? <ul className="mt-3 space-y-4">{items.map((item, i) => <li key={i} className="text-base leading-7"><p>{item.claim}</p><div className="mt-2 flex flex-wrap gap-2">{item.sourceIds.map(id => <a key={id} href={`#thesis-source-${id}`} className="rounded border border-foreground/15 px-2 py-1 text-sm text-signal underline underline-offset-4">{thesis.sources.find(s => s.id === id)?.label ?? id}</a>)}</div></li>)}</ul> : <p className="mt-3 text-base leading-7 text-muted-foreground">{empty}</p>}</section>;
}

export function ResearchThesisView({ thesis, reviewStatus }: { thesis: ResearchThesis; reviewStatus: ResearchReport["reviewStatus"] }) {
  const carried = reviewStatus !== "complete";
  return <section aria-label="Persistent research thesis" className="space-y-5 rounded-lg border border-signal/25 bg-signal/5 p-4 sm:p-5">
    <div><div className="flex flex-wrap items-center justify-between gap-3"><h4 className="text-sm font-semibold uppercase tracking-wider text-signal">Working thesis</h4><span className="text-sm text-attention">{carried ? "Previous review · not refreshed" : verdicts[thesis.verdict]}</span></div><p className="specimen-serif mt-3 text-2xl leading-8">{thesis.statement}</p><p className="mt-3 text-sm text-muted-foreground">Reviewed {date(thesis.reviewedAt)}</p>
      {carried ? <p role="status" className="mt-3 text-base leading-7 text-attention">This check did not complete a new review. The thesis below is remembered from an earlier report, with its original evidence. It is not a current verdict.</p> : <p className="mt-3 text-base leading-7 text-muted-foreground"><span className="font-semibold text-foreground">{changes[thesis.change]}.</span> {thesis.changeReason}</p>}
    </div>
    <div className="grid gap-5 border-t border-foreground/12 pt-5 md:grid-cols-2"><Findings title="What supports it" items={thesis.support} thesis={thesis} empty="No supporting observation was established in this review." /><Findings title="What challenges it" items={thesis.challenges} thesis={thesis} empty="No direct counterevidence was established. That does not confirm the thesis." /></div>
    <section className="border-t border-foreground/12 pt-5"><h5 className="font-semibold">What would change this reading</h5><ul className="mt-3 list-disc space-y-2 pl-5 text-base leading-7 text-muted-foreground">{thesis.invalidationConditions.map((condition, i) => <li key={i}>{condition}</li>)}</ul></section>
    <section><h5 className="font-semibold">Next evidence to seek</h5><ul className="mt-3 list-disc space-y-2 pl-5 text-base leading-7 text-muted-foreground">{thesis.nextChecks.map((check, i) => <li key={i}>{check}</li>)}</ul><p className="mt-3 text-sm leading-6 text-muted-foreground">Repeat checks revisit the connected sources. Checks needing other data remain open questions.</p></section>
    <details className="border-t border-foreground/12 pt-4"><summary className="cursor-pointer text-base font-semibold">Review notes & remembered evidence</summary><p className="mt-3 text-sm leading-6 text-muted-foreground">One AI review pass, not independent verification. These notes summarize concerns and decisions; they are not an agent conversation.</p>
      <dl className="mt-4 space-y-4">{thesis.reviewNotes.map((note, i) => <div key={i}><dt className="text-base font-semibold">{note.issue}</dt><dd className="mt-1 text-base leading-7 text-muted-foreground">{note.resolution}</dd></div>)}</dl>
      <h5 className="mt-5 font-semibold">Unresolved gaps</h5><ul className="mt-2 list-disc space-y-2 pl-5 text-base leading-7 text-muted-foreground">{thesis.unknowns.map((gap, i) => <li key={i}>{gap}</li>)}</ul>
      <div className="mt-5 space-y-4">{thesis.sources.map(source => <section id={`thesis-source-${source.id}`} key={source.id} className="scroll-mt-24 rounded border border-foreground/12 p-4"><h5 className="font-semibold">{source.label}</h5><p className="mt-2 text-sm text-muted-foreground">{source.freshness === "recent" ? "Recent when reviewed" : source.freshness} · Evidence time: {source.evidenceAt ? date(source.evidenceAt) : "Unavailable"}</p><ul className="mt-3 list-disc space-y-2 pl-5 text-base leading-7">{source.facts.map((fact, i) => <li key={i}>{fact}</li>)}</ul><ul className="mt-3 space-y-2 text-sm leading-6 text-muted-foreground">{source.limitations.map((limit, i) => <li key={i}>{limit}</li>)}</ul><a href={source.url} target="_blank" rel="noreferrer" className="mt-3 inline-block text-sm text-signal underline underline-offset-4">Open source</a></section>)}</div>
    </details>
  </section>;
}
