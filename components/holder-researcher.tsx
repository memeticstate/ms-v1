"use client";

import { robinhoodExplorer, canonicalRobinhoodExplorerUrl } from "@/lib/robinhood-explorer";

import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowUpRight, Clock3, Loader2, Pause, Play, Plus, RefreshCw, Trash2 } from "lucide-react";
import { useMemeticAuth } from "@/components/memetic-auth-provider";
import { TokenSearch } from "@/components/token-search";
import { TokenLabel, CopyContract } from "./token-identity";
import { TokenAvatar } from "@/components/token-avatar";
import { ResearchThesisView } from "@/components/research-thesis";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { AlertDialog, AlertDialogTrigger, AlertDialogContent, AlertDialogTitle, AlertDialogDescription, AlertDialogFooter, AlertDialogAction, AlertDialogCancel } from "@/components/ui/alert-dialog";
import type { TokenSearchResult } from "@/lib/tokens/model";
import { RESEARCH_LIMITS, type ResearchTask, type ResearchRun, type ResearchReport, type ResearchFocus, type ResearchCadence } from "@/lib/researcher/model";

type Workspace = { assignments: ResearchTask[]; runs: ResearchRun[]; configured: boolean; usage: { used: number; limit: number } };
const short = (ca: string) => `${ca.slice(0, 6)}…${ca.slice(-4)}`;
const date = (value: number | string | null) => value ? new Date(value).toLocaleString(undefined, { timeZoneName: "short" }) : "Not recorded";
const panel = "rounded-2xl border border-foreground/12 bg-[var(--surface-1)] p-5 sm:p-6";
const focusLabels: Record<ResearchFocus, string> = { overview: "Overview", participation: "Participation", risk: "Evidence gaps", thesis: "Test a thesis" };
const prompts: Record<ResearchFocus, string> = {
  overview: "What can we establish about this token, and what should I check next?",
  participation: "Is participation broadening? Separate recent evidence from older observations.",
  risk: "Which concentration or coverage gaps most limit a reliable reading of this token?",
  thesis: "My thesis is that participation is broadening. What evidence supports or challenges it?",
};
const errorMessages: Record<string, string> = {
  assignment_limit: "You have five assignments. Remove one to make room.",
  check_limit_or_busy: "A check is already pending, was requested within the last minute, or today’s research allowance is full. Try again later.",
  assignment_paused: "Resume this assignment before starting a check.",
  assignment_not_found: "This assignment is no longer available. Refresh your workspace.",
  invalid_assignment: "Choose a contract and enter a question between 8 and 1,200 characters.",
  check_interrupted: "This check was interrupted. Run it again when you’re ready.",
  check_unavailable: "The check could not complete. Your earlier reports are still saved.",
  holder_access_required: "Holder access could not be confirmed. Recheck access, then resume this assignment.",
};

export function ResearchReportView({ report }: { report: ResearchReport }) {
  return <div className="space-y-5">
    <div className="flex flex-wrap items-center justify-between gap-3 border-b border-foreground/12 pb-4 text-sm text-muted-foreground">
      <span className={report.mode === "ai" ? "text-signal" : "text-attention"}>{report.mode === "ai" ? report.reviewStatus === "complete" ? "Reviewed AI interpretation · inspect the sources" : "Earlier AI interpretation · no skeptical review" : "Evidence collected · no reviewed AI interpretation"}</span>
      <span>Checked {date(report.generatedAt)}</span>
    </div>
    {report.analysis ? <>
      <p className="text-xl leading-8">{report.analysis.answer}</p>
      {!report.thesis ? <div className="space-y-4">{report.analysis.findings.map((finding, i) => <div key={i}><p className="text-base leading-7">{finding.claim}</p><div className="mt-2 flex flex-wrap gap-2">{finding.sourceIds.map(id => <a key={id} href={`#research-source-${id}`} className="rounded border border-foreground/15 px-2 py-1 text-sm text-signal underline underline-offset-4">{report.sources.find(s => s.id === id)?.label}</a>)}</div></div>)}</div> : null}
    </> : <p className="text-base leading-7 text-muted-foreground">{report.analysisStatus === "not_configured" ? "AI analysis is not connected yet. These are collected source observations and measured changes; your research question has not received an AI answer." : "AI analysis was unavailable for this check. The collected evidence is preserved below."}</p>}
    {report.thesis ? <ResearchThesisView thesis={report.thesis} reviewStatus={report.reviewStatus} /> : <p className="text-sm leading-6 text-muted-foreground">A working thesis and its review history will appear after the first successful AI review.</p>}
    <section className="border-t border-foreground/12 pt-5"><h4 className="text-base font-semibold">What changed since the last check</h4><ul className="mt-3 list-disc space-y-2 pl-5 text-base leading-7 text-muted-foreground">{report.changes.map((change, i) => <li key={i}>{change}</li>)}</ul></section>
    {report.analysis ? <div className="grid gap-5 border-t border-foreground/12 pt-5 md:grid-cols-2">
      <section><h4 className="font-semibold">Still uncertain</h4><ul className="mt-3 list-disc space-y-2 pl-5 text-base leading-7 text-muted-foreground">{report.analysis.unknowns.map((item, i) => <li key={i}>{item}</li>)}</ul></section>
      <section><h4 className="font-semibold">Useful next checks</h4><ul className="mt-3 list-disc space-y-2 pl-5 text-base leading-7 text-muted-foreground">{report.analysis.nextChecks.map((item, i) => <li key={i}>{item}</li>)}</ul></section>
    </div> : null}
    <section className="border-t border-foreground/12 pt-5"><h4 className="font-semibold">Evidence behind the reading</h4><div className="mt-4 space-y-3">{report.sources.map(source => <details key={source.id} id={`research-source-${source.id}`} open={report.mode === "evidence"} className="scroll-mt-24 rounded border border-foreground/12 p-4">
      <summary className="cursor-pointer text-base font-semibold">{source.label} <span className={`ml-2 text-sm font-normal ${source.freshness === "recent" ? "text-signal" : "text-attention"}`}>{source.freshness === "recent" ? "Recent when checked" : source.freshness === "historical" ? "Historical / freshness unverified" : "Unavailable"}</span></summary>
      <p className="mt-3 text-sm text-muted-foreground">Evidence time: {date(source.evidenceAt)} · Retrieved: {date(source.fetchedAt)}</p>
      {source.facts.length ? <ul className="mt-3 list-disc space-y-2 pl-5 text-base leading-7">{source.facts.map((fact, i) => <li key={i}>{fact}</li>)}</ul> : null}
      <ul className="mt-3 space-y-2 text-sm leading-6 text-muted-foreground">{source.limitations.map((limit, i) => <li key={i}>{limit}</li>)}</ul>
      <a href={canonicalRobinhoodExplorerUrl(source.url)} target="_blank" rel="noreferrer" className="mt-4 inline-flex items-center gap-1 text-sm text-signal underline underline-offset-4">Open source <ArrowUpRight className="size-4" /></a>
    </details>)}</div></section>
    <details className="text-sm text-muted-foreground"><summary className="cursor-pointer">Investigation steps</summary><ol className="mt-3 list-decimal space-y-2 pl-5">{report.steps.map((step, i) => <li key={i}>{step.tool}: {step.note}{step.code && <code className="ml-2 break-all text-xs" aria-label={`Diagnostic code: ${step.code}`}>{step.code}</code>}</li>)}</ol></details>
  </div>;
}

export function HolderResearcher({ accessExpiresAt, initialToken, view = "ask" }: { accessExpiresAt: string | null; initialToken: string | null; view?: "ask" | "saved" }) {
  const { authFetch, identityVersion } = useMemeticAuth();
  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [reportId, setReportId] = useState<string | null>(null);
  const [creating, setCreating] = useState(view === "ask");
  const [token, setToken] = useState(initialToken ?? "");
  const [identity, setIdentity] = useState<TokenSearchResult | null>(null);
  const [focus, setFocus] = useState<ResearchFocus>("overview");
  const [question, setQuestion] = useState(prompts.overview);
  const [cadence, setCadence] = useState<ResearchCadence>("manual");
  const [busy, setBusy] = useState(false), [error, setError] = useState(""), [notice, setNotice] = useState("");
  const [expired, setExpired] = useState(false);
  const session = useRef(0), reading = useRef<AbortController | null>(null), writing = useRef<AbortController | null>(null);
  const selectedRef = useRef(selected); selectedRef.current = selected;

  useEffect(() => {
    if (!initialToken) return;
    setToken(initialToken); setIdentity(null);
    if (view === "ask") setCreating(true);
  }, [initialToken, view]);

  const request = useCallback(async (path: string, init: RequestInit) => {
    const response = await authFetch(path, { ...init, cache: "no-store" });
    const result = await response.json();
    if (init.signal?.aborted) throw new DOMException("Request aborted", "AbortError");
    if (!response.ok) {
      if (response.status === 401 || response.status === 403) { setWorkspace(null); setExpired(true); }
      throw new Error(response.status === 401 || response.status === 403 ? "Recheck holder access to reopen your private research." : errorMessages[result.error] ?? "Research is temporarily unavailable. Please retry.");
    }
    return result;
  }, [authFetch]);
  const load = useCallback(async (id: string | null, quiet = false) => {
    reading.current?.abort(); const controller = new AbortController(); reading.current = controller;
    const version = session.current;
    try {
      const data = await request(`/api/premium/researcher${id ? `?id=${encodeURIComponent(id)}` : ""}`, { signal: controller.signal }) as Workspace;
      if (controller.signal.aborted || version !== session.current || (id && id !== selectedRef.current)) return;
      setWorkspace(data);
      if (!id && data.assignments[0]) setSelected(data.assignments[0].id);
      if (!data.assignments.length && view === "ask") setCreating(true);
      if (!quiet) setError("");
    } catch (caught) { if (!controller.signal.aborted && version === session.current) setError(caught instanceof Error ? caught.message : "Research is unavailable."); }
  }, [request, view]);
  useEffect(() => {
    session.current++; setWorkspace(null); setSelected(null); setReportId(null); setExpired(false); setError(""); setNotice("");
    void load(null);
    return () => { session.current++; reading.current?.abort(); writing.current?.abort(); };
  }, [identityVersion, load]);
  useEffect(() => { if (selected && !expired) { setReportId(null); void load(selected); } }, [selected, expired, load]);
  useEffect(() => {
    const expires = accessExpiresAt ? Date.parse(accessExpiresAt) : 0;
    const timer = window.setTimeout(() => { session.current++; reading.current?.abort(); writing.current?.abort(); setWorkspace(null); setExpired(true); }, Math.max(0, expires - Date.now()));
    return () => window.clearTimeout(timer);
  }, [accessExpiresAt]);
  const runs = workspace?.runs.filter(run => run.assignmentId === selected) ?? [];
  const running = runs.some(run => run.status === "queued" || run.status === "running");
  useEffect(() => {
    if (expired) return;
    const timer = window.setInterval(() => { if (document.visibilityState === "visible") void load(selectedRef.current, true); }, running ? 3500 : 60_000);
    return () => window.clearInterval(timer);
  }, [running, expired, load]);

  async function mutate(method: string, input: Record<string, unknown>) {
    if (busy || expired) return;
    writing.current?.abort(); const controller = new AbortController(); writing.current = controller;
    const version = session.current; setBusy(true); setError(""); setNotice("");
    try {
      const result = await request("/api/premium/researcher", { method, signal: controller.signal, headers: { "content-type": "application/json" }, body: JSON.stringify(input) });
      if (controller.signal.aborted || version !== session.current) return;
      const nextId = result.deleted ? null : result.assignment?.id ?? selectedRef.current;
      selectedRef.current = nextId; setSelected(nextId); setReportId(null);
      if (input.action === "create") { setCreating(false); setNotice(result.runId ? "Assignment saved. Your first check is queued." : "Assignment saved. Run its first check when research capacity is available."); }
      else if (input.action === "run") setNotice("Check queued. Your report will appear here.");
      else if (method === "PATCH") setNotice(input.paused ? "Assignment paused. A check already in progress may finish." : "Assignment updated.");
      await load(nextId);
    } catch (caught) { if (!controller.signal.aborted && version === session.current) setError(caught instanceof Error ? caught.message : "Could not save this change."); }
    finally { if (version === session.current) setBusy(false); }
  }
  const task = workspace?.assignments.find(t => t.id === selected);
  const currentRun = runs.find(r => r.id === reportId) ?? runs.find(r => r.report);
  const latestRun = runs[0];
  const currentReport = currentRun?.report;
  if (expired) return <div className={panel}><p className="text-base leading-7">Recheck holder access above to reopen your private researcher.</p></div>;
  return <section aria-label="Holder researcher" className="space-y-4">
    <header className={panel}><div className="flex flex-wrap items-start justify-between gap-4"><div><p className="text-sm uppercase tracking-widest text-attention">{view === "saved" ? "Saved questions and reports" : "Ask the researcher"}</p><h3 className="specimen-serif mt-2 text-3xl sm:text-4xl">{view === "saved" ? "Pick up where you left off." : "One token. One useful question."}</h3><p className="mt-3 max-w-2xl text-base leading-7 text-muted-foreground">{view === "saved" ? "Open an assignment to compare its dated readings, run a new check, or change its schedule." : "Save a question about a token. Gather the evidence, follow what changes, and keep a dated reading."}</p></div>{view === "saved" ? <a href="/app/research" className="inline-flex items-center gap-2 rounded border border-foreground/15 px-4 py-2 text-sm"><Plus className="size-4" />Ask a new question</a> : <Button variant="outline" onClick={() => setCreating(true)} disabled={busy || (workspace?.assignments.length ?? 0) >= RESEARCH_LIMITS.assignments}><Plus />New question</Button>}</div>
      <div className="mt-5 flex flex-wrap gap-x-6 gap-y-2 text-sm text-muted-foreground"><span>Private to your account</span><span>Robinhood Chain · PONS sources</span>{workspace ? <span>{workspace.usage.used} / {workspace.usage.limit} checks today · resets at 00:00 UTC</span> : null}</div>
      {workspace && !workspace.configured ? <p className="mt-4 rounded border border-attention/25 p-3 text-sm leading-6 text-attention">Evidence collection is available. AI interpretation has not been connected yet.</p> : null}
    </header>
    {error ? <div role="alert" className={`${panel} text-attention`}><p>{error}</p><Button variant="outline" onClick={() => void load(selected)} className="mt-3"><RefreshCw />Refresh workspace</Button></div> : null}
    {notice ? <p role="status" className="px-2 text-base text-signal">{notice}</p> : null}
    {!workspace && !error ? <p role="status" className="flex items-center gap-2 p-5 text-base text-muted-foreground"><Loader2 className="size-4 animate-spin" />Opening your research…</p> : null}
    {view === "saved" && workspace && !workspace.assignments.length ? <p className={`${panel} text-base leading-7 text-muted-foreground`}>No saved questions yet. Ask about a token to start a dated research record.</p> : null}
    {creating && workspace ? <form className={panel} onSubmit={e => { e.preventDefault(); void mutate("POST", { action: "create", tokenAddress: token, question, focus, cadence }); }}>
      <div className="flex items-center justify-between gap-3"><h4 className="text-xl font-semibold">A new assignment</h4>{workspace.assignments.length ? <Button type="button" variant="ghost" onClick={() => setCreating(false)}>Cancel</Button> : null}</div>
      <p className="mt-2 text-sm leading-6 text-muted-foreground">Choose one token and one question. Source coverage varies; unsupported questions remain explicit gaps.</p>
      <div className="mt-5"><TokenSearch onSelect={item => { setIdentity(item); setToken(item.tokenAddress); }} /></div>
      {identity && identity.tokenAddress === token ? <div className="mt-3 flex items-center gap-3"><TokenAvatar token={identity} className="flex size-10 items-center justify-center rounded bg-signal/20 font-semibold" /><span className="text-base"><TokenLabel token={identity} /></span></div> : null}
      <label className="mt-4 block text-sm font-semibold" htmlFor="assignment-ca">Token contract</label><Input id="assignment-ca" className="mt-2 font-mono text-sm" value={token} onChange={e => { setToken(e.target.value); setIdentity(null); }} placeholder="0x…" maxLength={42} required />
      <div className="mt-5 grid gap-4 sm:grid-cols-2"><div><label className="mb-2 block text-sm font-semibold" htmlFor="research-focus">Research focus</label><Select value={focus} onValueChange={value => { const next = value as ResearchFocus; if (question === prompts[focus]) setQuestion(prompts[next]); setFocus(next); }}><SelectTrigger id="research-focus" className="w-full"><SelectValue /></SelectTrigger><SelectContent>{Object.entries(focusLabels).map(([value, label]) => <SelectItem key={value} value={value}>{label}</SelectItem>)}</SelectContent></Select></div>
      <div><label className="mb-2 block text-sm font-semibold" htmlFor="research-cadence">Check again</label><Select value={cadence} onValueChange={value => setCadence(value as ResearchCadence)}><SelectTrigger id="research-cadence" className="w-full"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="manual">When I ask</SelectItem><SelectItem value="daily">Daily</SelectItem><SelectItem value="hourly">Hourly · within daily allowance</SelectItem></SelectContent></Select></div></div>
      <label htmlFor="research-question" className="mt-5 block text-sm font-semibold">What should it investigate?</label><Textarea id="research-question" className="mt-2 min-h-28 text-base" value={question} onChange={e => setQuestion(e.target.value)} minLength={8} maxLength={1200} required />
      <p className="mt-2 text-sm leading-6 text-muted-foreground">Questions and token evidence are sent to the AI provider when analysis is connected. Keep personal information out of your brief.</p>
      <div className="mt-5 flex flex-wrap items-center gap-4"><Button type="submit" disabled={busy || !/^0x[0-9a-f]{40}$/i.test(token.trim()) || question.trim().length < 8}>{busy ? <Loader2 className="animate-spin" /> : <ArrowUpRight />}Save & investigate</Button><span className="text-sm text-muted-foreground">Up to five assignments. Scheduled checks may be delayed or limited by daily capacity.</span></div>
    </form> : null}
    {workspace?.assignments.length ? <div className="grid items-start gap-4 lg:grid-cols-[280px_minmax(0,1fr)]"><aside className={panel}><h4 className="mb-4 text-sm font-semibold uppercase tracking-wider text-muted-foreground">Your assignments</h4><div className="space-y-2">{workspace.assignments.map(item => <button key={item.id} type="button" aria-pressed={selected === item.id} onClick={() => { setSelected(item.id); setCreating(false); }} className={`w-full rounded border p-3 text-left ${selected === item.id ? "border-signal/40 bg-signal/10" : "border-foreground/10 hover:bg-foreground/5"}`}><span className="block font-mono text-sm text-signal"><TokenLabel token={{ tokenAddress: item.tokenAddress, name: null, symbol: null }} /></span><span className="mt-2 line-clamp-3 block text-base leading-6">{item.question}</span><span className="mt-3 block text-sm text-muted-foreground">{item.paused ? "Paused" : item.cadence === "manual" ? "Checks on request" : `${item.cadence[0].toUpperCase()}${item.cadence.slice(1)} checks`}</span></button>)}</div></aside>
    <article className={`${panel} min-w-0`}>
      {task ? <><div className="flex flex-wrap items-start justify-between gap-4"><div className="min-w-0"><p className="text-sm text-attention">{focusLabels[task.focus]}</p><h4 className="specimen-serif mt-2 break-words text-2xl sm:text-3xl"><TokenLabel token={{ tokenAddress: task.tokenAddress, symbol: currentReport?.symbol ?? null, name: currentReport?.name ?? null }} /></h4><CopyContract address={task.tokenAddress} className="mt-2" /></div><Button onClick={() => void mutate("POST", { action: "run", id: task.id })} disabled={busy || running || task.paused || workspace.usage.used >= workspace.usage.limit}><RefreshCw className={running ? "animate-spin" : ""} />{running ? "Checking…" : "Run now"}</Button></div>
        <p className="mt-4 text-base leading-7">{task.question}</p>
        <div className="mt-5 flex flex-wrap items-center gap-3 border-y border-foreground/12 py-4"><Select value={task.cadence} onValueChange={value => void mutate("PATCH", { id: task.id, paused: task.paused, cadence: value })} disabled={busy}><SelectTrigger className="w-48" aria-label="Assignment repeat schedule"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="manual">When I ask</SelectItem><SelectItem value="hourly">Hourly</SelectItem><SelectItem value="daily">Daily</SelectItem></SelectContent></Select><Button variant="outline" disabled={busy} onClick={() => void mutate("PATCH", { id: task.id, paused: !task.paused, cadence: task.cadence })}>{task.paused ? <Play /> : <Pause />}{task.paused ? "Resume" : "Pause"}</Button>
          <AlertDialog><AlertDialogTrigger asChild><Button variant="ghost" aria-label="Delete assignment" disabled={busy}><Trash2 /></Button></AlertDialogTrigger><AlertDialogContent><AlertDialogTitle>Remove this assignment?</AlertDialogTitle><AlertDialogDescription>Its saved reports will also be deleted and future checks will stop.</AlertDialogDescription><AlertDialogFooter><AlertDialogCancel>Keep assignment</AlertDialogCancel><AlertDialogAction onClick={() => void mutate("DELETE", { id: task.id })}>Remove assignment</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog>
          <span className="flex items-center gap-2 text-sm text-muted-foreground"><Clock3 className="size-4" />{task.paused ? "Checks paused" : task.nextRunAt ? `${task.nextRunAt <= Date.now() ? "Due since" : "Next check due"} ${date(task.nextRunAt)}` : "Checks run when requested"}</span>
        </div>
        {running ? <p role="status" className="my-4 text-base text-signal">Your check is {latestRun?.status === "queued" ? "queued" : "collecting evidence"}. This view refreshes automatically.</p> : null}
        {latestRun?.error ? <p role="status" className="my-4 text-base leading-7 text-attention">{errorMessages[latestRun.error] ?? "The last check could not complete."}</p> : null}
        {currentReport ? <div className="mt-5"><div className="mb-4 flex flex-wrap items-center justify-between gap-3"><h4 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">Saved reading</h4><Select value={currentRun!.id} onValueChange={setReportId}><SelectTrigger className="w-full sm:w-64" aria-label="Saved report date"><SelectValue /></SelectTrigger><SelectContent>{runs.filter(r => r.report).map(r => <SelectItem key={r.id} value={r.id}>{date(r.finishedAt ?? r.requestedAt)}</SelectItem>)}</SelectContent></Select></div><ResearchReportView report={currentReport} /></div> : !running ? <p className="mt-6 text-base leading-7 text-muted-foreground">No reading saved yet. Run a check to establish the first observation.</p> : null}
      </> : <p className="text-base text-muted-foreground">Choose an assignment to open its research.</p>}
    </article></div> : null}
  </section>;
}
