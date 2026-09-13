"use client";

import { useEffect, useRef, useState } from "react";
import { Archive, BookmarkPlus, ExternalLink, RefreshCw, Save, Trash2 } from "lucide-react";
import { useMemeticAuth } from "@/components/memetic-auth-provider";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { CASE_LIMIT, CASE_EVIDENCE_LIMIT, compareCaseEvidence, type CaseFields, type CaseSummary, type ResearchCase, type CaseEvidence } from "@/lib/premium/cases";
import type { ResearchDossier } from "@/lib/premium/research";
import type { PremiumAccess } from "@/lib/entitlements/token-gate";

const box = "rounded-lg border border-foreground/12 bg-[var(--surface-1)] p-5 sm:p-6";
const empty: CaseFields = { title: "", thesis: "", invalidationNote: "", outcomeNote: "", status: "open" };
const time = (value: string | null) => value ? new Date(value).toLocaleString() : "Not reviewed";
const messages: Record<string, string> = {
  case_capacity_or_id_conflict: "The case limit was reached. Delete a case before saving another.",
  case_changed_reload: "This case changed in another session. Reopen it before saving; your text is still here.",
  evidence_window_changed: "The indexed records changed. Reopen the research window and choose the evidence again.",
  case_evidence_too_large: "This snapshot is too large. Select fewer attached events and try saving again.",
  invalid_case: "Add a title, thesis, and invalidation condition within the stated limits.",
  case_not_found: "This case is unavailable for this account.",
  premium_access_required: "Recheck holder access to open or change case files.",
  sign_in_required: "Sign in to use your case files.",
};
type CasePayload = { premiumAccess?: PremiumAccess; cases?: CaseSummary[]; caseFile?: ResearchCase; error?: string; deleted?: boolean };

function Fields({ value, change, prefix, outcome = false }: { value: CaseFields; change: (value: CaseFields) => void; prefix: string; outcome?: boolean }) {
  return <div className="space-y-4">
    <div><label htmlFor={`${prefix}-title`} className="text-sm font-semibold">Case title</label><Input id={`${prefix}-title`} maxLength={120} value={value.title} onChange={e => change({ ...value, title: e.target.value })} className="mt-2" placeholder="What are you investigating?" /></div>
    <div><label htmlFor={`${prefix}-thesis`} className="text-sm font-semibold">Your thesis</label><Textarea id={`${prefix}-thesis`} maxLength={4000} rows={4} value={value.thesis} onChange={e => change({ ...value, thesis: e.target.value })} className="mt-2 text-base" placeholder="What do you think the evidence shows, and why?" /></div>
    <div><label htmlFor={`${prefix}-invalidation`} className="text-sm font-semibold">What would invalidate it?</label><Textarea id={`${prefix}-invalidation`} maxLength={2000} rows={3} value={value.invalidationNote} onChange={e => change({ ...value, invalidationNote: e.target.value })} className="mt-2 text-base" placeholder="Name an observable change that would make you reconsider." /></div>
    {outcome ? <><div><label htmlFor={`${prefix}-outcome`} className="text-sm font-semibold">Outcome / review notes</label><Textarea id={`${prefix}-outcome`} maxLength={4000} rows={4} value={value.outcomeNote} onChange={e => change({ ...value, outcomeNote: e.target.value })} className="mt-2 text-base" /></div><div><p className="mb-2 text-sm font-semibold">Your assessment</p><Select value={value.status} onValueChange={status => change({ ...value, status: status as CaseFields["status"] })}><SelectTrigger aria-label="Case assessment" className="w-full"><SelectValue /></SelectTrigger><SelectContent>{["open", "supported", "invalidated", "archived"].map(status => <SelectItem key={status} value={status}>{status[0].toUpperCase() + status.slice(1)}</SelectItem>)}</SelectContent></Select></div></> : null}
  </div>;
}

function Snapshot({ evidence, title }: { evidence: CaseEvidence; title: string }) {
  const data = evidence.dossier;
  return <details className="rounded border border-foreground/12 p-4"><summary className="cursor-pointer text-base font-semibold">{title} · block {data.coverage.throughBlock.toLocaleString()}</summary>
    <p className="mt-3 text-sm leading-6 text-muted-foreground">Captured {time(evidence.capturedAt)} · {data.coverage.current ? "current within the index at capture" : "historical / incomplete at capture"} · {evidence.capturedRecords} attached records.</p>
    <h4 className="mt-4 font-semibold">{data.note.label}</h4><p className="mt-2 text-sm leading-6">{data.note.interpretation}</p>
    <div className="mt-4 grid gap-3 sm:grid-cols-3">{data.windows.map(window => <div key={window.label} className="rounded bg-[var(--surface-2)] p-3 text-sm"><p>{window.label}</p><p className="mt-2">{window.trades} {window.sampled ? "sampled" : "indexed"} trades · {window.actors} wallets</p><p className="mt-2 text-muted-foreground">{window.fromBlock.toLocaleString()}–{window.toBlock.toLocaleString()}</p></div>)}</div>
    <p className="mt-4 text-sm leading-6 text-muted-foreground">{data.coverage.limitation}</p>
    <ul className="mt-4 space-y-2 text-sm">{data.ecology.sources.map(source => <li key={source.id}><strong>{source.label}:</strong> {source.relationship} · {time(source.observedAt)} · {source.status}</li>)}</ul>
    <div className="mt-4 space-y-2">{data.history.records.map(record => <a key={record.id} href={record.sourceUrl} target="_blank" rel="noreferrer" className="flex items-center gap-2 text-sm underline underline-offset-4">{record.kind} · block {record.blockNumber.toLocaleString()} / log {record.logIndex}<ExternalLink className="size-3" /></a>)}</div>
  </details>;
}

export function PremiumCaseFiles({ dossier, accessExpiresAt }: { dossier: ResearchDossier | null; accessExpiresAt: string | null }) {
  const { authFetch, identityVersion } = useMemeticAuth();
  const [cases, setCases] = useState<CaseSummary[]>([]);
  const [selected, setSelected] = useState<ResearchCase | null>(null);
  const [draft, setDraft] = useState<CaseFields>(empty);
  const [edit, setEdit] = useState<CaseFields>(empty);
  const [evidenceIds, setEvidenceIds] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [expiresAt, setExpiresAt] = useState<string | null>(null);
  const pending = useRef<AbortController | null>(null);
  const sequence = useRef(0);
  const draftId = useRef<string | null>(null);

  async function call(url: string, method = "GET", body?: unknown) {
    pending.current?.abort(); const controller = new AbortController(); pending.current = controller;
    const response = await authFetch(url, { method, cache: "no-store", signal: controller.signal, ...(body ? { headers: { "content-type": "application/json" }, body: JSON.stringify(body) } : {}) });
    const data = await response.json() as CasePayload;
    if (controller.signal.aborted) throw new DOMException("Aborted", "AbortError");
    if (!response.ok) throw new Error(messages[data.error ?? ""] ?? "Case files are temporarily unavailable. Your unsaved text has been kept.");
    if (data.premiumAccess?.expiresAt) setExpiresAt(data.premiumAccess.expiresAt);
    return data;
  }
  async function run(action: () => Promise<void>) {
    const own = ++sequence.current; setBusy(true); setMessage("");
    try { await action(); } catch (error) { if (own === sequence.current && !(error instanceof DOMException && error.name === "AbortError")) setMessage(error instanceof Error ? error.message : "Case files are unavailable."); }
    finally { if (own === sequence.current) setBusy(false); }
  }
  async function refreshList() { const data = await call("/api/premium/cases"); setCases(data.cases ?? []); }
  function openCase(data: ResearchCase) { setSelected(data); setEdit({ title: data.title, thesis: data.thesis, invalidationNote: data.invalidationNote, outcomeNote: data.outcomeNote, status: data.status }); setConfirmDelete(false); }

  useEffect(() => { setCases([]); setSelected(null); setDraft(empty); setEdit(empty); setEvidenceIds([]); draftId.current = null; void run(refreshList); return () => { sequence.current++; pending.current?.abort(); }; }, [identityVersion]);
  useEffect(() => { setEvidenceIds([]); }, [dossier?.generatedAt]);
  useEffect(() => {
    const expiry = Math.max(expiresAt ? Date.parse(expiresAt) : 0, accessExpiresAt ? Date.parse(accessExpiresAt) : 0);
    if (!expiry) return;
    const timer = window.setTimeout(() => { sequence.current++; pending.current?.abort(); setCases([]); setSelected(null); setDraft(empty); setEdit(empty); setBusy(false); setMessage("The holder check expired. Recheck access to reopen your cases."); }, Math.max(0, expiry - Date.now()));
    return () => window.clearTimeout(timer);
  }, [expiresAt, accessExpiresAt]);

  async function saveNew() {
    if (!dossier) return;
    await run(async () => {
      draftId.current ??= crypto.randomUUID();
      const data = await call("/api/premium/cases", "POST", { ...draft, id: draftId.current, evidenceIds,
        query: { token: dossier.token.address, through: dossier.coverage.throughBlock, window: dossier.selection.windowBlocks, kind: dossier.selection.kind, scope: dossier.selection.scope, ...(dossier.history.pageCursor ? { cursor: dossier.history.pageCursor } : {}) } });
      if (data.caseFile) openCase(data.caseFile); draftId.current = null; setDraft(empty); setEvidenceIds([]); await refreshList(); setMessage("Case saved. Its original evidence snapshot is preserved.");
    });
  }
  async function changeCase(review = false) {
    if (!selected) return;
    await run(async () => {
      const data = await call("/api/premium/cases", "PATCH", review ? { id: selected.id, version: selected.version, action: "review" } : { ...edit, id: selected.id, version: selected.version });
      if (data.caseFile) openCase(data.caseFile); await refreshList(); setMessage(review ? "Latest available evidence captured. The original snapshot is preserved." : "Case notes saved.");
    });
  }
  const comparison = selected?.latestReview ? compareCaseEvidence(selected.original, selected.latestReview) : null;
  return <section className="space-y-4" aria-label="Private research case files">
    <div className={box}><div className="flex flex-wrap items-center justify-between gap-3"><div><p className="font-mono text-sm uppercase tracking-[0.1em] text-attention">Your case files</p><h3 className="specimen-serif mt-2 text-3xl">Keep the thesis. Test the next observation.</h3></div><Button variant="outline" disabled={busy} onClick={() => void run(refreshList)}><RefreshCw className={busy ? "animate-spin" : ""} />Reload cases</Button></div><p className="mt-3 text-sm leading-6 text-muted-foreground">Private to your signed-in account, saved across sessions. Up to {CASE_LIMIT} cases; each snapshot keeps its window metrics, source context, prompts, and up to {CASE_EVIDENCE_LIMIT} attached events. Reviews preserve the original and replace only the latest review. Outcomes are your assessment.</p>{message ? <p role="status" className="mt-4 text-sm leading-6 text-attention">{message}</p> : null}</div>
    <div className="grid items-start gap-4 lg:grid-cols-[minmax(220px,0.7fr)_minmax(0,1.3fr)]">
      <aside className={box}><p className="flex items-center gap-2 font-semibold"><Archive className="size-4" />Saved cases · {cases.length}/{CASE_LIMIT}</p><div className="mt-4 space-y-2">{cases.map(item => <button key={item.id} disabled={busy} onClick={() => void run(async () => { const data = await call(`/api/premium/cases?id=${item.id}`); if (data.caseFile) openCase(data.caseFile); })} className={`w-full rounded border p-3 text-left ${selected?.id === item.id ? "border-attention/40 bg-attention/5" : "border-foreground/10"}`}><p className="break-words text-base font-semibold">{item.title}</p><p className="mt-2 text-sm capitalize text-muted-foreground">{item.status} · {time(item.updatedAt)}</p></button>)}</div>{!cases.length ? <p className="mt-4 text-sm leading-6 text-muted-foreground">Open a research window and save your first thesis below.</p> : null}</aside>
      {selected ? <article className={`${box} space-y-5`}><div className="flex items-center justify-between gap-3"><h3 className="specimen-serif text-2xl">Review case</h3><Button variant="ghost" onClick={() => setSelected(null)} disabled={busy}>Close</Button></div><fieldset disabled={busy}><Fields prefix="edit-case" value={edit} change={setEdit} outcome /></fieldset><div className="flex flex-wrap gap-3"><Button onClick={() => void changeCase()} disabled={busy}><Save />Save notes</Button><Button variant="outline" onClick={() => void changeCase(true)} disabled={busy || JSON.stringify(edit) !== JSON.stringify({ title: selected.title, thesis: selected.thesis, invalidationNote: selected.invalidationNote, outcomeNote: selected.outcomeNote, status: selected.status })}><RefreshCw />Compare latest evidence</Button></div><p className="text-sm leading-6 text-muted-foreground">Save edited notes before comparing. The comparison uses the same window size at the latest indexed block; it may still be historical.</p>
        {comparison ? <div className="rounded border border-attention/25 p-4 text-sm leading-6"><p className="font-semibold">Evidence block {comparison.beforeBlock.toLocaleString()} → {comparison.afterBlock.toLocaleString()}</p><p className="mt-2">{comparison.advanced ? "The recorded evidence window advanced." : "No newer evidence block is available."} {comparison.current ? "The latest read meets current index freshness checks." : "The latest read remains historical / incomplete."}</p><p className="mt-2">{comparison.comparable ? `Change in indexed window: ${comparison.trades! >= 0 ? "+" : ""}${comparison.trades} trades, ${comparison.wallets! >= 0 ? "+" : ""}${comparison.wallets} wallet addresses. Collection gaps can affect this comparison.` : "Sample limits prevent a numerical comparison."}</p></div> : null}
        <Snapshot title="Original evidence" evidence={selected.original} />{selected.latestReview ? <Snapshot title="Latest review evidence" evidence={selected.latestReview} /> : null}
        <div className="border-t border-foreground/10 pt-4">{confirmDelete ? <div className="flex flex-wrap items-center gap-3"><p className="text-sm">Delete this case and its snapshots?</p><Button variant="destructive" disabled={busy} onClick={() => void run(async () => { await call("/api/premium/cases", "DELETE", { id: selected.id, version: selected.version }); setSelected(null); setConfirmDelete(false); await refreshList(); setMessage("Case deleted."); })}>Confirm delete</Button><Button variant="ghost" onClick={() => setConfirmDelete(false)} disabled={busy}>Cancel</Button></div> : <Button variant="ghost" disabled={busy} onClick={() => setConfirmDelete(true)}><Trash2 />Delete case</Button>}</div>
      </article> : <div className={box}><p className="text-base leading-7 text-muted-foreground">Choose a saved case to review its thesis, original evidence, and latest outcome.</p></div>}
    </div>
    <section className={box}><p className="flex items-center gap-2 text-sm font-semibold text-attention"><BookmarkPlus className="size-4" />Capture the open research window</p>{dossier ? <><h3 className="specimen-serif mt-3 text-2xl">{dossier.token.symbol} · block {dossier.coverage.throughBlock.toLocaleString()}</h3><p className="mt-3 text-sm leading-6 text-muted-foreground">{dossier.selection.windowBlocks.toLocaleString()}-block comparison windows · {dossier.coverage.current ? "current indexed reading" : "historical / incomplete reading"}. The original snapshot is captured when you save.</p><fieldset disabled={busy} className="mt-5"><Fields prefix="new-case" value={draft} change={setDraft} /></fieldset><details className="mt-5 rounded border border-foreground/10 p-4"><summary className="cursor-pointer text-sm font-semibold">Attach specific events · {evidenceIds.length}/{CASE_EVIDENCE_LIMIT} selected</summary><p className="mt-3 text-sm leading-6 text-muted-foreground">Leave this empty to attach the first {CASE_EVIDENCE_LIMIT} available records on this page. Selection is limited to this page.</p><div className="mt-4 max-h-64 space-y-3 overflow-y-auto">{dossier.history.records.map(record => <label key={record.id} className="flex items-start gap-3 text-sm"><Checkbox checked={evidenceIds.includes(record.id)} disabled={busy || (!evidenceIds.includes(record.id) && evidenceIds.length >= CASE_EVIDENCE_LIMIT)} onCheckedChange={checked => setEvidenceIds(ids => checked ? [...ids, record.id] : ids.filter(id => id !== record.id))} /><span>{record.kind} · block {record.blockNumber.toLocaleString()} / log {record.logIndex}</span></label>)}</div></details><Button className="mt-5" onClick={() => void saveNew()} disabled={busy || !draft.title.trim() || !draft.thesis.trim() || !draft.invalidationNote.trim() || cases.length >= CASE_LIMIT}><BookmarkPlus />Save private case</Button></> : <p className="mt-4 text-base leading-7 text-muted-foreground">Open evidence in the Research tab first. Saved cases remain available independently of the token you are browsing.</p>}</section>
  </section>;
}
