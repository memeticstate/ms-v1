"use client";

import { robinhoodExplorer, canonicalRobinhoodExplorerUrl } from "@/lib/robinhood-explorer";

import { useEffect, useRef, useState } from "react";
import { BookOpen, CheckCircle2, ExternalLink, History, LockKeyhole, RefreshCw, Search, ShieldCheck } from "lucide-react";
import { formatUnits } from "viem";
import { useMemeticAuth } from "@/components/memetic-auth-provider";
import { Button } from "@/components/ui/button";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { PremiumWorkflowPanels } from "@/components/premium-workflow-panels";
import { PremiumCaseFiles } from "@/components/premium-case-files";
import { PremiumRecentCurve } from "@/components/premium-recent-curve";
import { HolderResearcher } from "@/components/holder-researcher";
import { RESEARCH_WINDOW_OPTIONS } from "@/lib/premium/workflow";
import type { PassportResponse } from "@/lib/entitlements/client";
import type { PremiumAccess } from "@/lib/entitlements/token-gate";
import type { PonsLaunchView } from "@/lib/pons/model";
import { type ResearchDossier } from "@/lib/premium/research";

type Payload = { premiumAccess: PremiumAccess; dossier: ResearchDossier | null; error?: string };
const short = (address: string) => `${address.slice(0, 6)}…${address.slice(-4)}`;
const time = (value: string | null) => value ? new Date(value).toLocaleString(undefined, { timeZoneName: "short" }) : "Not recorded";
const box = "rounded-lg border border-foreground/12 bg-[var(--surface-1)] p-5 sm:p-6";
const label = "font-mono text-sm uppercase tracking-[0.1em] text-attention";

function quantity(raw: string | null, decimals: number | null) {
  if (raw === null || decimals === null) return "Unavailable";
  try { return formatUnits(BigInt(raw), decimals); } catch { return "Unavailable"; }
}

function ResearchContent({ data, loadOlder, loadNewest, loading, olderPage }: { data: ResearchDossier; loadOlder: () => void; loadNewest: () => void; loading: boolean; olderPage: boolean }) {
  const evidence = data.holderEvidence;
  return <div className="space-y-4">
    <section className={`${box} border-attention/25`}>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div><p className={label}>Research dossier · PONS V2</p><h3 className="specimen-serif mt-2 text-3xl sm:text-4xl">{data.token.symbol === "—" ? data.token.name : data.token.symbol}<span className="ml-3 text-xl text-muted-foreground">{data.token.quoteSymbol} habitat</span></h3></div>
        <span className={`rounded border px-3 py-2 text-sm ${data.coverage.current ? "border-signal/30 text-signal" : "border-attention/30 text-attention"}`}>{data.coverage.current ? "Current indexed evidence" : "Historical / incomplete coverage"}</span>
      </div>
      <dl className="mt-5 grid gap-4 text-sm sm:grid-cols-2 lg:grid-cols-4">
        <div><dt className="text-muted-foreground">Evidence through</dt><dd className="mt-1 font-mono">Block {data.coverage.throughBlock.toLocaleString()}</dd></div>
        <div><dt className="text-muted-foreground">Latest collection</dt><dd className="mt-1">{time(data.coverage.lastCollectedAt)}</dd></div>
        <div><dt className="text-muted-foreground">Earliest indexed trade</dt><dd className="mt-1">{time(data.coverage.earliestIndexedTradeAt)}</dd></div>
        <div><dt className="text-muted-foreground">Distance from observed head</dt><dd className="mt-1 font-mono">{data.coverage.lagBlocks.toLocaleString()} blocks</dd></div>
      </dl>
      <p className="mt-4 text-sm leading-6 text-muted-foreground">{data.coverage.limitation}</p>
    </section>

    <div className="grid gap-4 lg:grid-cols-[1.15fr_1fr]">
      <article className={box}><p className={label}>Research note</p><h3 className="specimen-serif mt-3 text-3xl">{data.note.label}</h3><p className="mt-4 text-base leading-7 text-foreground/85">{data.note.interpretation}</p><h4 className="mt-6 font-semibold text-signal">Observed in the index</h4><ul className="mt-3 space-y-3 text-sm leading-6 text-muted-foreground">{data.note.observed.map((item) => <li key={item}>{item}</li>)}</ul><p className="mt-6 text-sm leading-6 text-muted-foreground">{data.note.method}</p></article>
      <article className={box}><p className={label}>What would change this reading?</p><ul className="mt-4 list-disc space-y-3 pl-5 text-base leading-7 text-foreground/85">{data.note.invalidation.map((item) => <li key={item}>{item}</li>)}</ul><div className="mt-6 border-t border-foreground/12 pt-5"><h4 className="font-semibold text-signal">Investigate next</h4><p className="mt-2 text-base leading-7 text-muted-foreground">{data.note.next}</p></div></article>
    </div>

    <section className={box}><p className={label}>Compare recorded windows</p><p className="mt-2 text-sm leading-6 text-muted-foreground">Three consecutive {data.selection.windowBlocks.toLocaleString()}-block windows. Counts cover indexed curve trades; a capped sample or a collection gap limits comparisons.</p><div className="mt-5 grid gap-3 md:grid-cols-3">{data.windows.map((period) => <article key={period.label} className="rounded border border-foreground/10 bg-[var(--surface-2)] p-4"><h3 className="text-base font-semibold">{period.label}</h3><p className="mt-1 font-mono text-sm text-muted-foreground">{period.fromBlock.toLocaleString()}–{period.toBlock.toLocaleString()}</p><p className="mt-4 text-3xl font-semibold text-signal">{period.trades.toLocaleString()} <span className="text-sm font-normal text-muted-foreground">{period.sampled ? "sampled trades" : "indexed trades"}</span></p><p className="mt-3 text-sm leading-6">{period.actors.toLocaleString()} wallet addresses · {period.buys.toLocaleString()} buys · {period.sells.toLocaleString()} sells</p><p className="mt-3 text-sm leading-6 text-muted-foreground">Last trade: {time(period.lastTradeAt)}</p></article>)}</div></section>

    <PremiumWorkflowPanels data={data} />

    <div className="grid gap-4 lg:grid-cols-2">
      <section className={box}><p className={label}>Identity and source records</p><dl className="mt-4 space-y-3 text-sm">{[["Token", data.token.address], ["Curve", data.token.curveAddress], ["Creator", data.token.creator], ["Quote asset", data.token.quoteAddress]].map(([name, address]) => <div key={name} className="flex flex-wrap items-center justify-between gap-2"><dt className="text-muted-foreground">{name}</dt><dd><a href={robinhoodExplorer.address(address)} target="_blank" rel="noreferrer" className="inline-flex items-center gap-2 break-all font-mono underline underline-offset-4" title={address}>{short(address)}<ExternalLink className="size-3" /></a></dd></div>)}</dl><p className="mt-5 text-sm leading-6 text-muted-foreground">Launch: {time(data.token.launchedAt)} · <a className="underline" href={robinhoodExplorer.tx(data.token.launchTransaction)} target="_blank" rel="noreferrer">View launch transaction</a></p></section>
      <section className={box}><p className={label}>Holder evidence</p>{evidence?.observedAt ? <><p className="mt-3 text-sm leading-6 text-muted-foreground">Observed {time(evidence.observedAt)} · {evidence.holdersComplete ? "Complete returned distribution" : "Partial holder sample"} · {evidence.sampleBasis ?? "Source sample"}</p><dl className="mt-4 grid grid-cols-2 gap-4 text-sm"><div><dt className="text-muted-foreground">Reported holder count</dt><dd className="mt-1 text-xl">{evidence.holderCount ?? "Unavailable"}</dd></div><div><dt className="text-muted-foreground">Wallets sampled</dt><dd className="mt-1 text-xl">{evidence.holderSampleSize}</dd></div><div><dt className="text-muted-foreground">Reserve share</dt><dd className="mt-1 text-xl">{evidence.reserveSharePercent === null ? "Unavailable" : `${evidence.reserveSharePercent.toFixed(2)}%`}</dd></div><div><dt className="text-muted-foreground">Largest sampled wallet</dt><dd className="mt-1 text-xl">{evidence.largestWalletSharePercent === null ? "Unavailable" : `${evidence.largestWalletSharePercent.toFixed(2)}%`}</dd></div></dl></> : <p className="mt-4 text-base leading-7 text-muted-foreground">A current holder observation has not been verified for this token. No holder-strength claim is inferred from trade counts.</p>}</section>
    </div>

    <section className={box}><div className="flex flex-wrap items-center justify-between gap-3"><div><p className={label}>Indexed event history</p><p className="mt-2 text-sm text-muted-foreground">{data.history.records.length} records on this page · newest first · transaction links open the source</p></div><History className="size-5 text-attention" /></div>
      {data.history.records.length ? <div className="mt-5 overflow-x-auto"><Table className="w-full min-w-[680px] text-left text-sm"><TableHeader className="border-b border-foreground/15 text-muted-foreground"><TableRow>{["Event", "Block / log", "Event time", "Quote amount", "Evidence"].map((item) => <TableHead key={item} className="px-3 py-3 font-medium">{item}</TableHead>)}</TableRow></TableHeader><TableBody>{data.history.records.map((record) => <TableRow key={record.id} className="border-b border-foreground/8 align-top"><TableCell className={`px-3 py-3 ${record.kind === "buy" ? "text-signal" : record.kind === "sell" ? "text-attention" : "text-foreground"}`}>{record.kind.replaceAll("-", " ")}</TableCell><TableCell className="px-3 py-3 font-mono">{record.blockNumber.toLocaleString()} / {record.logIndex}</TableCell><TableCell className="px-3 py-3">{time(record.observedAt)}</TableCell><TableCell className="max-w-52 break-all px-3 py-3 font-mono">{record.quoteAmountRaw === null ? "—" : `${quantity(record.quoteAmountRaw, data.token.quoteDecimals)} ${data.token.quoteSymbol}`}</TableCell><TableCell className="px-3 py-3"><a href={canonicalRobinhoodExplorerUrl(record.sourceUrl)} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 underline underline-offset-4">Transaction<ExternalLink className="size-3" /></a><details className="mt-2"><summary className="cursor-pointer text-muted-foreground">Record details</summary><div className="mt-2 max-w-60 space-y-2 break-all text-sm"><p>Indexed: {time(record.indexedAt)}</p><p>Actor / emitter: {record.actor ?? "Not recorded"}</p>{record.tokenAmountRaw !== null ? <p>Token amount, base units: {record.tokenAmountRaw}</p> : null}<p>Source: {record.transaction}:{record.logIndex}</p></div></details></TableCell></TableRow>)}</TableBody></Table></div> : <p className="mt-5 text-base leading-7 text-muted-foreground">No records are available in this part of the index. That does not establish that no activity occurred onchain.</p>}
      <div className="mt-5 flex flex-wrap gap-3">{olderPage ? <Button variant="outline" onClick={loadNewest} disabled={loading}>Newest records</Button> : null}{data.history.nextCursor ? <Button variant="outline" onClick={loadOlder} disabled={loading}>{loading ? "Loading records…" : "Older indexed records"}</Button> : null}</div>
    </section>
    <section className={box}><p className={label}>Limits of this investigation</p><ul className="mt-4 list-disc space-y-2 pl-5 text-sm leading-6 text-muted-foreground">{data.note.missing.map((item) => <li key={item}>{item}</li>)}</ul></section>
  </div>;
}

export function PremiumResearchWorkspace({ passport, launches, initialToken, initialTab = "ask", onRefreshPassport }: { passport: PassportResponse | null; launches: PonsLaunchView[]; initialToken: string | null; initialTab?: "ask" | "brief" | "saved"; onRefreshPassport: (sync?: boolean) => Promise<void> }) {
  const { authenticated, identityVersion, authFetch, signIn, linkWallet, ready } = useMemeticAuth();
  const [token, setToken] = useState(initialToken ?? launches[0]?.tokenAddress ?? "");
  const [payload, setPayload] = useState<Payload | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [olderPage, setOlderPage] = useState(false);
  const [workspaceTab, setWorkspaceTab] = useState<string>(initialTab);
  const [windowBlocks, setWindowBlocks] = useState("25000");
  const [historyKind, setHistoryKind] = useState("all");
  const [historyScope, setHistoryScope] = useState("all");
  const [through, setThrough] = useState("");
  const [sessionAccess, setSessionAccess] = useState<PremiumAccess | null>(null);
  const pending = useRef<AbortController | null>(null);
  const candidateAccess = authenticated && passport?.authenticated ? sessionAccess ?? payload?.premiumAccess ?? passport.premiumAccess : null;
  const access = candidateAccess?.active && candidateAccess.expiresAt && Date.parse(candidateAccess.expiresAt) <= Date.now() ? { ...candidateAccess, active: false, reason: "Your holder check expired. Recheck access to continue." } : candidateAccess;

  useEffect(() => {
    pending.current?.abort();
    setPayload(null); setError(""); setLoading(false); setOlderPage(false);
    return () => pending.current?.abort();
  }, [identityVersion, token, windowBlocks, historyKind, historyScope, through]);

  useEffect(() => {
    if (initialToken) setToken(initialToken);
  }, [initialToken]);

  useEffect(() => { setWorkspaceTab(initialTab); }, [initialTab]);

  useEffect(() => { setSessionAccess(null); }, [identityVersion]);

  useEffect(() => {
    if (!authenticated || !candidateAccess?.active || !candidateAccess.expiresAt) return;
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      try {
        const response = await authFetch("/api/entitlements/refresh", { method: "POST", signal: controller.signal });
        const result = await response.json() as { premiumAccess?: PremiumAccess };
        if (controller.signal.aborted) return;
        if (!response.ok || !result.premiumAccess) throw new Error("Holder verification is temporarily unavailable.");
        setSessionAccess(result.premiumAccess);
        if (!result.premiumAccess.active) { pending.current?.abort(); setPayload(null); }
      } catch { if (!controller.signal.aborted) setError("Holder verification could not refresh. Access will pause when the current check expires."); }
    }, Math.max(0, Date.parse(candidateAccess.expiresAt) - Date.now() - 15_000));
    return () => { controller.abort(); window.clearTimeout(timer); };
  }, [authenticated, identityVersion, candidateAccess?.active, candidateAccess?.expiresAt, authFetch]);

  useEffect(() => {
    if (!candidateAccess?.active || !candidateAccess.expiresAt) return;
    const expires = Date.parse(candidateAccess.expiresAt);
    const timer = window.setTimeout(() => { pending.current?.abort(); setSessionAccess({ ...candidateAccess, active: false }); setPayload(null); setLoading(false); setError("Your holder check has expired. Recheck access to continue."); }, Math.max(0, expires - Date.now()));
    return () => window.clearTimeout(timer);
  }, [candidateAccess?.active, candidateAccess?.expiresAt]);

  async function load(cursor?: string) {
    pending.current?.abort();
    const controller = new AbortController(); pending.current = controller;
    setLoading(true); setError("");
    try {
      const params = new URLSearchParams({ token: token.trim().toLowerCase(), window: windowBlocks, kind: historyKind, scope: historyScope });
      if (through.trim()) params.set("through", through.trim());
      if (cursor && payload?.dossier) { params.set("cursor", cursor); params.set("through", String(payload.dossier.history.throughBlock)); }
      const response = await authFetch(`/api/premium/research?${params}`, { cache: "no-store", signal: controller.signal });
      const next = await response.json() as Payload;
      if (!response.ok) throw new Error(response.status === 401 ? "Sign in to open premium research." : response.status === 403 ? "The verified wallet does not currently meet the 0.1% access requirement. Recheck access below." : response.status === 400 ? "Check the token contract, evidence block, and history filters." : "Research is temporarily unavailable. Please retry.");
      if (controller.signal.aborted) return;
      setPayload(next); setSessionAccess(next.premiumAccess); setOlderPage(Boolean(cursor));
      if (!next.dossier) setError("This token is not in the supported PONS V2 index yet. Choose an indexed token or try again after collection.");
    } catch (caught) {
      if (controller.signal.aborted) return;
      setPayload(null); setError(caught instanceof Error ? caught.message : "Research is unavailable.");
    } finally { if (!controller.signal.aborted) setLoading(false); }
  }

  async function recheck() {
    setLoading(true); setError(""); setPayload(null);
    try {
      const response = await authFetch("/api/entitlements/refresh", { method: "POST" });
      if (!response.ok) throw new Error("Holder verification is unavailable. Please retry.");
      const checked = await response.json() as { premiumAccess: PremiumAccess };
      setSessionAccess(checked.premiumAccess);
      await onRefreshPassport(true);
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Holder verification is unavailable."); }
    finally { setLoading(false); }
  }

  return <section className="space-y-4" aria-label="Holder research workspace">
    <div className={`${box} border-attention/25`}><div className="flex flex-wrap items-start justify-between gap-4"><div><p className={label}>Research for holders</p><h2 className="specimen-serif mt-2 text-3xl sm:text-4xl">{initialTab === "saved" ? "Keep a record. Return with a question." : "What do you want to understand?"}</h2><p className="mt-3 max-w-3xl text-base leading-7 text-muted-foreground">Ask about a token, inspect a dated brief, or return to your saved research.</p></div><span className="inline-flex items-center gap-2 rounded border border-attention/25 px-3 py-2 text-sm text-attention">{access?.active ? <CheckCircle2 className="size-4" /> : <LockKeyhole className="size-4" />}0.1% holder access</span></div>
      {!access?.active ? <div className="mt-6"><div className="grid gap-3 md:grid-cols-3">{[[Search, "ASK", "Give the researcher a token and a question to follow."], [History, "TOKEN BRIEF", "Read dated evidence, compare windows, and follow the sources."], [BookOpen, "SAVED", "Revisit assignments, reports, and your private case files."]].map(([Icon, title, copy]) => { const Mark = Icon as typeof Search; return <div key={String(title)} className="rounded border border-foreground/10 bg-[var(--surface-2)] p-4"><Mark className="size-5 text-attention" /><h3 className="mt-3 text-base font-semibold">{String(title)}</h3><p className="mt-2 text-sm leading-6 text-muted-foreground">{String(copy)}</p></div>; })}</div><p className="mt-5 text-base leading-7 text-muted-foreground">{access?.reason ?? "Connect and verify a wallet to check eligibility. Hold at least 0.1% of the fixed supply reference in the verified primary wallet."}</p><div className="mt-4 flex flex-wrap gap-3">{!authenticated ? <Button onClick={signIn} disabled={!ready}><LockKeyhole />Connect wallet</Button> : <><Button variant="outline" onClick={linkWallet} disabled={!ready}>Link holder wallet</Button><Button onClick={() => void recheck()} disabled={loading}><RefreshCw className={loading ? "animate-spin" : ""} />Recheck access</Button></>}<a href="/docs/premium" className="inline-flex items-center gap-2 px-2 text-sm underline underline-offset-4">Read premium terms<ExternalLink className="size-3" /></a></div></div>
      : <div className="mt-6"><p className="flex flex-wrap items-center gap-2 text-sm text-signal"><ShieldCheck className="size-4" />Verified wallet {short(access.walletAddress ?? "")} · minimum {quantity(access.requiredBalanceRaw, access.tokenDecimals)} tokens</p><p className="mt-2 text-sm text-muted-foreground">Supply reference: block {access.supplyReferenceBlock?.toLocaleString() ?? "pending"}. Access is rechecked at most every two minutes.</p>{workspaceTab === "brief" ? <><div className="mt-5 grid gap-3 sm:grid-cols-[1fr_1fr_auto]">
        <Select value={launches.some((launch) => launch.tokenAddress === token) ? token : undefined} onValueChange={setToken}><SelectTrigger className="w-full" aria-label="Choose indexed token"><SelectValue placeholder="Choose an indexed token" /></SelectTrigger><SelectContent>{launches.map((launch) => <SelectItem key={launch.tokenAddress} value={launch.tokenAddress}>{launch.symbol === "—" ? launch.name : launch.symbol} · {launch.pairSymbol} · {short(launch.tokenAddress)}</SelectItem>)}</SelectContent></Select>
        <Input aria-label="Token contract to investigate" value={token} onChange={(event) => setToken(event.target.value)} placeholder="Or paste a token contract" className="font-mono text-sm" />
        <Button onClick={() => void load()} disabled={loading || !/^0x[0-9a-f]{40}$/i.test(token.trim())}><Search />{loading ? "Reading evidence…" : "Open token brief"}</Button>
      </div>
      <div className="mt-5 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <div><p className="mb-2 text-sm font-semibold">Comparison window</p><Select value={windowBlocks} onValueChange={setWindowBlocks}><SelectTrigger aria-label="Comparison window size" className="w-full"><SelectValue /></SelectTrigger><SelectContent>{RESEARCH_WINDOW_OPTIONS.map(size => <SelectItem key={size} value={String(size)}>{size.toLocaleString()} blocks</SelectItem>)}</SelectContent></Select></div>
        <div><label htmlFor="research-through" className="mb-2 block text-sm font-semibold">Evidence through block</label><Input id="research-through" inputMode="numeric" value={through} onChange={e => setThrough(e.target.value)} placeholder="Latest indexed block" /></div>
        <div><p className="mb-2 text-sm font-semibold">History records</p><Select value={historyKind} onValueChange={setHistoryKind}><SelectTrigger aria-label="History event filter" className="w-full"><SelectValue /></SelectTrigger><SelectContent>{[["all", "All events"], ["buy", "Buys"], ["sell", "Sells"], ["lifecycle", "Lifecycle events"]].map(([value, title]) => <SelectItem key={value} value={value}>{title}</SelectItem>)}</SelectContent></Select></div>
        <div><p className="mb-2 text-sm font-semibold">History range</p><Select value={historyScope} onValueChange={setHistoryScope}><SelectTrigger aria-label="History range" className="w-full"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">All indexed history</SelectItem><SelectItem value="window">Selected window only</SelectItem></SelectContent></Select></div>
      </div><p className="mt-3 text-sm leading-6 text-muted-foreground">Choose a window and select Open token brief. Older history pages keep the same evidence anchor and filters.</p></> : null}
      <button type="button" onClick={() => void recheck()} disabled={loading} className="mt-4 text-sm underline underline-offset-4">Recheck holder access</button></div>}
      {error ? <p role="status" className="mt-4 text-sm leading-6 text-attention">{error}</p> : null}
    </div>
    {authenticated && access?.active && workspaceTab === "brief" && /^0x[0-9a-f]{40}$/i.test(token.trim()) ? <PremiumRecentCurve key={`${identityVersion}:${token.trim().toLowerCase()}`} token={token.trim().toLowerCase()} /> : null}
    {authenticated && access?.active ? <Tabs value={workspaceTab} onValueChange={setWorkspaceTab}><TabsList aria-label="Premium research workspace" className="w-full justify-start"><TabsTrigger value="ask">ASK</TabsTrigger><TabsTrigger value="brief">TOKEN BRIEF</TabsTrigger><TabsTrigger value="saved">SAVED</TabsTrigger></TabsList><TabsContent value="ask" className="mt-3"><HolderResearcher key={identityVersion} accessExpiresAt={access.expiresAt} initialToken={initialToken} view="ask" /></TabsContent><TabsContent value="brief" className="mt-3 space-y-4">{payload?.dossier ? <><div className="flex justify-end"><Button variant="outline" onClick={() => setWorkspaceTab("saved")}><BookOpen />Save this window as a case</Button></div><ResearchContent data={payload.dossier} loading={loading} olderPage={olderPage} loadOlder={() => void load(payload.dossier?.history.nextCursor ?? undefined)} loadNewest={() => void load()} /></> : <div className={box}><p className="text-base leading-7 text-muted-foreground">Open an indexed token to inspect its evidence, source relationships, and research paths.</p></div>}</TabsContent><TabsContent value="saved" forceMount className="mt-3 space-y-6 data-[state=inactive]:hidden">{workspaceTab === "saved" ? <HolderResearcher key={`${identityVersion}:saved`} accessExpiresAt={access.expiresAt} initialToken={null} view="saved" /> : null}<PremiumCaseFiles key={identityVersion} dossier={payload?.dossier ?? null} accessExpiresAt={access.expiresAt} /></TabsContent></Tabs> : null}
    <details className={`${box} text-sm leading-6`}><summary className="cursor-pointer text-base font-semibold">How to use premium research</summary><ol className="mt-4 list-decimal space-y-2 pl-5"><li>Choose a token and open a 25,000-block window. Check its coverage date before interpreting the counts.</li><li>Read the history and source relationships. Write one thesis and a condition that would prove it wrong.</li><li>Save the window as a private case. Return to Saved, compare the latest indexed evidence, and record your outcome.</li></ol><p className="mt-3 text-muted-foreground">For discovery while the archive is delayed, use the fresh factory feed and the separate Recent curve check. A comparison with no newer indexed blocks does not show a new market outcome.</p><a href="/docs/premium" className="mt-3 inline-block underline underline-offset-4">Read the worked example</a></details>
  </section>;
}
