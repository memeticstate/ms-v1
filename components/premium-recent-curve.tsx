"use client";

import { useEffect, useRef, useState } from "react";
import { ExternalLink, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useMemeticAuth } from "@/components/memetic-auth-provider";
import { EXPLORER } from "@/lib/premium/research";
import { recentCurveIsFresh, type RecentCurveResult } from "@/lib/premium/recent-curve";

const date = (value: string) => new Date(value).toLocaleString(undefined, { timeZoneName: "short" });
const short = (value: string) => `${value.slice(0, 6)}…${value.slice(-4)}`;

export function PremiumRecentCurve({ token }: { token: string }) {
  const { authFetch } = useMemeticAuth();
  const [result, setResult] = useState<RecentCurveResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [now, setNow] = useState(Date.now);
  const current = useRef<AbortController | null>(null);
  const auth = useRef(authFetch); auth.current = authFetch;
  async function read(refresh = false) {
    current.current?.abort();
    const controller = new AbortController(); current.current = controller;
    setBusy(true); setError("");
    try {
      const response = await auth.current(`/api/premium/recent-curve?token=${encodeURIComponent(token)}`, { method: refresh ? "POST" : "GET", cache: "no-store", signal: controller.signal });
      if (response.status === 401 || response.status === 403) setResult(null);
      if (!response.ok) throw new Error(response.status === 404 ? "This contract has not been discovered by the PONS V2 factory feed yet." : response.status === 429 ? "Another recent check is running. Try again shortly." : response.status === 401 || response.status === 403 ? "Recheck your holder access to continue." : "The recent check is unavailable. Any previous observation below keeps its original date.");
      const payload = await response.json() as { recentCurve: RecentCurveResult };
      if (controller.signal.aborted) return;
      setResult(payload.recentCurve);
      if (payload.recentCurve.lastError) setError("The last refresh could not be verified. Any previous observation below keeps its original date.");
    } catch (caught) {
      if (!controller.signal.aborted) setError(caught instanceof Error ? caught.message : "Recent check unavailable.");
    } finally { if (!controller.signal.aborted) { setBusy(false); setNow(Date.now()); } }
  }
  useEffect(() => {
    void read();
    const timer = window.setInterval(() => setNow(Date.now()), 5_000);
    return () => { current.current?.abort(); window.clearInterval(timer); };
  }, [token]);
  const check = result?.check;
  const fresh = recentCurveIsFresh(check ?? null, now) && !error;
  const retrySeconds = Math.max(0, Math.ceil(((result?.retryAt ? Date.parse(result.retryAt) : 0) - now) / 1000));
  return <section className="rounded-lg border border-signal/25 bg-[var(--surface-1)] p-5 sm:p-6" aria-label="Recent curve check">
    <div className="flex flex-wrap items-start justify-between gap-4"><div><h3 className="text-xl font-semibold">Recent curve check</h3><p className="mt-2 max-w-3xl text-sm leading-6 text-muted-foreground">Check up to 2,000 recent blocks directly on this token’s PONS V2 curve. You can paste a contract from the factory feed before its trade archive has caught up.</p></div><Button variant="outline" onClick={() => void read(true)} disabled={busy || retrySeconds > 0}><RefreshCw className={busy ? "animate-spin" : ""} />{busy ? "Checking…" : retrySeconds ? `Check again in ${retrySeconds}s` : "Check recent curve"}</Button></div>
    {error ? <p role="status" className="mt-4 text-sm leading-6 text-attention">{error}</p> : null}
    {check ? <div className="mt-5 space-y-4">
      <p className={`text-sm ${fresh ? "text-signal" : "text-attention"}`}>{fresh ? "Recent observation" : "Dated observation · refresh before use"} · chain observed {date(check.headObservedAt)}</p>
      <dl className="grid grid-cols-2 gap-4 sm:grid-cols-4">{[["Curve trades", check.trades], ["Buys", check.buys], ["Sells", check.sells], ["Distinct actors", check.actors]].map(([title, value]) => <div key={title}><dt className="text-sm text-muted-foreground">{title}</dt><dd className="mt-1 font-mono text-2xl">{Number(value).toLocaleString()}</dd></div>)}</dl>
      <p className="text-sm leading-6 text-muted-foreground">Window: #{check.fromBlock.toLocaleString()}–#{check.throughBlock.toLocaleString()} · {date(check.fromTime)}–{date(check.throughTime)}. Source: {check.provider}, one RPC provider. <a href={`${EXPLORER}/address/${check.curveAddress}`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 underline underline-offset-4">Inspect curve <ExternalLink className="size-3" /></a></p>
      {check.trades === 0 ? <p className="text-sm leading-6 text-muted-foreground">No curve trades were returned for this exact window. Trading may have moved to a pool after graduation.</p> : <details><summary className="cursor-pointer text-sm underline underline-offset-4">Inspect {check.recentTrades.length} most recent transactions</summary><ul className="mt-3 grid gap-2 sm:grid-cols-2">{check.recentTrades.map(trade => <li key={trade.id} className="text-sm"><a href={`${EXPLORER}/tx/${trade.transaction}`} target="_blank" rel="noreferrer" className="underline underline-offset-4">{trade.side} · #{trade.blockNumber.toLocaleString()} · {short(trade.actor)}</a></li>)}</ul></details>}
    </div> : <p className="mt-4 text-sm leading-6 text-muted-foreground">Select Check recent curve to collect an observation for {short(token)}.</p>}
    <p className="mt-5 border-t border-foreground/10 pt-4 text-sm leading-6 text-muted-foreground">Curve activity only. Swaps after graduation, holders and other venues are outside this check. This observation stays separate from historical comparisons and saved case snapshots. An incomplete or failed response is shown as unavailable.</p>
  </section>;
}
