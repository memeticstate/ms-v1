"use client";

import { canonicalRobinhoodExplorerUrl } from "@/lib/robinhood-explorer";

import { ExternalLink } from "lucide-react";
import type { ResearchDossier } from "@/lib/premium/research";

const box = "rounded-lg border border-foreground/12 bg-[var(--surface-1)] p-5 sm:p-6";
const label = "font-medium text-sm tracking-normal text-attention";
const time = (value: string | null) => value ? new Date(value).toLocaleString() : "Not recorded";

export function PremiumWorkflowPanels({ data }: { data: ResearchDossier }) {
  return <div className="space-y-4">
    <section className={box} aria-labelledby="invalidation-paths">
      <p className={label}>Invalidation paths</p><h3 id="invalidation-paths" className="specimen-serif mt-2 text-3xl">Put the reading under pressure.</h3>
      <p className="mt-3 text-sm leading-6 text-muted-foreground">These checks flag questions in the recorded evidence. They do not automatically prove or invalidate a thesis.</p>
      <div className="mt-5 grid gap-3 md:grid-cols-2">{data.invalidationPaths.map(path => <article key={path.id} className="rounded border border-foreground/10 p-4">
        <div className="flex flex-wrap items-center justify-between gap-2"><h4 className="font-semibold">{path.title}</h4><span className={`rounded border px-2 py-1 text-sm ${path.status === "not-flagged" ? "text-signal border-signal/25" : "text-attention border-attention/25"}`}>{path.status === "review" ? "Review this change" : path.status === "unresolved" ? "Unresolved" : "Not flagged"}</span></div>
        <p className="mt-3 text-sm leading-6 text-muted-foreground">{path.basis}</p><p className="mt-3 text-base leading-7">{path.next}</p>
      </article>)}</div>
    </section>
    <section className={box} aria-labelledby="source-ecology">
      <p className={label}>Cross-source ecology</p><h3 id="source-ecology" className="specimen-serif mt-2 text-3xl">Trace the connection.</h3>
      <p className="mt-3 text-sm leading-6 text-muted-foreground">{data.ecology.limitation}</p>
      <div className="mt-5 grid gap-3 md:grid-cols-2">{data.ecology.sources.map(source => <article key={source.id} className="rounded border border-foreground/10 p-4">
        <div className="flex flex-wrap justify-between gap-2"><h4 className="font-semibold">{source.label}</h4><span className="text-sm text-muted-foreground">{source.status === "missing" ? "No matching record" : source.stale ? "Dated / delayed" : "Recent observation"}</span></div>
        <p className="mt-2 text-sm text-attention">{source.relationship}</p><p className="mt-3 text-sm leading-6 text-muted-foreground">{source.detail}</p>
        <div className="mt-4 flex flex-wrap items-center justify-between gap-2 text-sm"><span className="text-muted-foreground">{time(source.observedAt)}</span><a href={canonicalRobinhoodExplorerUrl(source.url)} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 underline underline-offset-4">Inspect source<ExternalLink className="size-3" /></a></div>
      </article>)}</div>
      {data.ecology.quote ? <p className="mt-5 rounded border border-foreground/10 p-4 text-sm leading-6">{data.ecology.quote.symbol} reference mid: <strong>{data.ecology.quote.mid.toLocaleString(undefined, { maximumFractionDigits: 4 })}</strong> · observed {time(data.ecology.quote.observedAt)} · {data.ecology.quote.halted ? "source reports halted" : "source did not report a halt"}. This reference quote is not a valuation of the selected community token.</p> : null}
      <h4 className="mt-6 font-semibold">Related indexed launches and habitats</h4>
      {data.ecology.peers.length ? <div className="mt-3 divide-y divide-foreground/10">{data.ecology.peers.map(peer => <div key={`${peer.source}:${peer.address}`} className="grid gap-2 py-3 text-sm sm:grid-cols-[1fr_1fr_auto]">
        <a href={canonicalRobinhoodExplorerUrl(peer.url)} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 font-semibold underline underline-offset-4">{peer.symbol}<ExternalLink className="size-3" /></a><div><p>{peer.source}</p><p className="mt-1 text-muted-foreground">{peer.relationship}</p></div><p className="text-muted-foreground">{time(peer.observedAt)}</p>
      </div>)}</div> : <p className="mt-3 text-sm leading-6 text-muted-foreground">No related records were found in the available sources. This is a coverage limit, not proof that the token is isolated.</p>}
    </section>
    <section className={box} aria-labelledby="research-prompts"><p className={label}>Research prompts</p><h3 id="research-prompts" className="specimen-serif mt-2 text-3xl">Give the next observation a purpose.</h3>
      <div className="mt-5 space-y-4">{data.prompts.map((prompt, index) => <article key={prompt.id} className="border-t border-foreground/10 pt-4"><p className="text-sm text-attention">Question {index + 1}</p><h4 className="mt-2 text-lg font-semibold">{prompt.question}</h4><p className="mt-2 text-sm leading-6 text-muted-foreground">{prompt.basis}</p><p className="mt-3 text-base leading-7">{prompt.next}</p><a href={canonicalRobinhoodExplorerUrl(prompt.url)} target="_blank" rel="noreferrer" className="mt-3 inline-flex items-center gap-1 text-sm underline underline-offset-4">Inspect evidence<ExternalLink className="size-3" /></a></article>)}</div>
    </section>
  </div>;
}
