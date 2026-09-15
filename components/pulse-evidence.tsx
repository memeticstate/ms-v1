"use client";

import { robinhoodExplorer } from "@/lib/robinhood-explorer";
import { useEffect, useState } from "react";
import { ArrowUpRight, ExternalLink, LoaderCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { pulseLabels, type PulseEvidenceResponse, type PulseSelection } from "@/lib/pons/pulse-evidence";

const integer = new Intl.NumberFormat("en-US");
const short = (value: string) => `${value.slice(0, 6)}…${value.slice(-4)}`;

export function PulseEvidence({ selection, onClose, onInspect }: {
  selection: PulseSelection; onClose: () => void; onInspect: (address: string) => void;
}) {
  const [page, setPage] = useState(0);
  const [data, setData] = useState<PulseEvidenceResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [retry, setRetry] = useState(0);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    const request = new AbortController();
    setLoading(true); setError(null);
    void fetch(`/api/pons-pulse?metric=${selection.metric}&toBlock=${selection.toBlock}&offset=${page * 25}`, { signal: request.signal, cache: "no-store" })
      .then(async (response) => {
        const result = await response.json();
        if (!response.ok) throw new Error(result.error || "Evidence is temporarily unavailable.");
        if (!request.signal.aborted) setData(result);
      })
      .catch((cause) => { if (!request.signal.aborted) setError(cause instanceof Error ? cause.message : "Evidence is temporarily unavailable."); })
      .finally(() => { if (!request.signal.aborted) setLoading(false); });
    return () => request.abort();
  }, [selection, page, retry]);

  return <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
    <DialogContent className="max-h-[85dvh] overflow-y-auto border-foreground/15 bg-[var(--surface-1)] p-0 sm:max-w-3xl">
      <div className="border-b border-foreground/10 p-5 pr-12 sm:p-6">
        <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-attention">Protocol pulse · explore the evidence</p>
        <DialogTitle className="specimen-serif mt-2 text-3xl font-normal sm:text-4xl">{pulseLabels[selection.metric]}<span className="ml-3 font-mono text-xl text-signal">{integer.format(data?.total ?? selection.displayedCount)}</span></DialogTitle>
        <DialogDescription className="mt-2 text-xs leading-5 text-muted-foreground">
          {data ? `Blocks #${integer.format(data.fromBlock)}–#${integer.format(data.toBlock)}. ` : `Interval ending at #${integer.format(selection.toBlock)}. `}
          This interval stays fixed while you explore. {selection.metric === "actors" ? "Wallets ranked by trades in this interval." : "Select a token to open its dossier."}
        </DialogDescription>
      </div>
      {loading ? <div role="status" className="flex items-center gap-2 p-8 text-sm text-muted-foreground"><LoaderCircle className="size-4 animate-spin" />Loading verified evidence…</div> : error ? <div role="alert" className="p-6 text-sm text-attention">{error}<Button variant="outline" className="ml-3" onClick={() => setRetry((value) => value + 1)}>Retry</Button></div> : <>
        {data && data.total !== selection.displayedCount ? <p className="px-5 text-xs text-attention">The ledger has been reconciled since this pulse was displayed. Showing the current evidence for the same interval.</p> : null}
        {data?.rows.length ? <div className="divide-y divide-foreground/[0.07]">{data.rows.map((row) => <div key={row.id} className="flex items-center justify-between gap-3 px-5 py-3.5 hover:bg-foreground/[0.025] sm:px-6">
          {selection.metric === "actors" ? <a href={robinhoodExplorer.address(row.address)} target="_blank" rel="noreferrer" className="group min-w-0 flex-1">
            <span className="flex items-center gap-2 font-mono text-sm text-foreground">{short(row.address)}<ArrowUpRight className="size-3.5 text-muted-foreground group-hover:text-attention" /></span>
            <span className="mt-1 block text-xs text-muted-foreground">{integer.format(row.tokens ?? 0)} token{row.tokens === 1 ? "" : "s"} · last active #{integer.format(row.block)}</span>
          </a> : <button type="button" onClick={() => { onClose(); onInspect(row.address); }} className="group min-w-0 flex-1 text-left focus-visible:outline-2 focus-visible:outline-signal">
            <span className="flex items-baseline gap-2"><strong className="truncate text-sm font-semibold text-foreground">{row.symbol || short(row.address)}</strong><span className="font-mono text-[10px] text-muted-foreground">{row.pair}</span><ArrowUpRight className="size-3.5 shrink-0 text-signal" /></span>
            <span className="mt-1 block font-mono text-[10px] text-muted-foreground">#{integer.format(row.block)} · {new Date(row.timestamp * 1000).toLocaleString()}</span>
          </button>}
          <div className="flex shrink-0 items-center gap-3"><span className={`font-mono text-xs ${row.action === "sell" ? "text-culture" : "text-signal"}`}>{selection.metric === "actors" ? `${integer.format(row.trades ?? 0)} trades` : row.action}</span>
            {row.txHash ? <a href={robinhoodExplorer.tx(row.txHash)} target="_blank" rel="noreferrer" aria-label="Open transaction on block explorer" className="rounded border border-foreground/10 p-2 text-muted-foreground hover:text-attention"><ExternalLink className="size-3.5" /></a> : null}</div>
        </div>)}</div> : <p className="p-6 text-sm text-muted-foreground">No {pulseLabels[selection.metric].toLowerCase()} were recorded in this interval.</p>}
        {data && data.total > 25 ? <div className="flex items-center justify-between gap-2 border-t border-foreground/10 p-4"><Button variant="outline" disabled={page === 0} onClick={() => setPage((value) => value - 1)}>Previous</Button><span className="font-mono text-xs text-muted-foreground">{integer.format(data.offset + 1)}–{integer.format(data.offset + data.rows.length)} of {integer.format(data.total)}</span><Button variant="outline" disabled={!data.hasMore} onClick={() => setPage((value) => value + 1)}>Next</Button></div> : null}
      </>}
    </DialogContent>
  </Dialog>;
}
