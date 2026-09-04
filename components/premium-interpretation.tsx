"use client";

import { useState } from "react";
import { BrainCircuit, CheckCircle2, LockKeyhole, RefreshCw, ShieldCheck } from "lucide-react";

import { Button } from "@/components/ui/button";
import type { PassportResponse } from "@/lib/entitlements/client";
import type { PremiumInterpretation } from "@/lib/interpretation/premium-brief";
import type { PremiumAccess } from "@/lib/entitlements/token-gate";

type Payload = {
  premiumAccess: PremiumAccess;
  interpretation: PremiumInterpretation;
};

export function PremiumInterpretationPanel({ passport, windowBlocks }: { passport: PassportResponse | null; windowBlocks: number }) {
  const [status, setStatus] = useState<"idle" | "loading" | "open" | "failed">("idle");
  const [brief, setBrief] = useState<PremiumInterpretation | null>(null);
  const [error, setError] = useState("");
  const authenticated = Boolean(passport?.authenticated);
  const access = passport?.authenticated ? passport.premiumAccess : null;

  const openInterpretation = async () => {
    setStatus("loading");
    setError("");
    try {
      const response = await fetch(`/api/premium/interpretation?window=${windowBlocks}`, { headers: { accept: "application/json" } });
      const payload = await response.json() as Partial<Payload> & { error?: string };
      if (!response.ok || !payload.interpretation) {
        throw new Error(payload.error === "premium_access_required" ? "Holder access is not active for this wallet." : "Interpretation is temporarily unavailable.");
      }
      setBrief(payload.interpretation);
      setStatus("open");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Interpretation is temporarily unavailable.");
      setStatus("failed");
    }
  };

  return (
    <section className="rounded-[9px] border border-culture/18 bg-[var(--surface-2)]/88 p-5 sm:p-7">
      <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-start">
        <div>
          <div className="flex items-center gap-2"><BrainCircuit className="size-4 text-culture" /><p className="font-mono text-[8px] uppercase tracking-[0.18em] text-culture">Premium interpretation</p></div>
          <h3 className="specimen-serif mt-3 text-3xl tracking-[-0.03em] text-foreground/88">A deeper read of the same public evidence.</h3>
          <p className="mt-3 max-w-2xl text-xs leading-6 text-foreground/34">The interpretation layer adds context and watchpoints without changing the underlying events, scores or rankings.</p>
        </div>
        {access?.active ? <span className="inline-flex items-center gap-2 self-start rounded border border-signal/24 bg-signal/[0.06] px-2.5 py-2 font-mono text-[7px] uppercase tracking-[0.12em] text-signal"><CheckCircle2 className="size-3.5" />Premium active</span> : <span className="inline-flex items-center gap-2 self-start rounded border border-foreground/12 bg-foreground/[0.025] px-2.5 py-2 font-mono text-[7px] uppercase tracking-[0.12em] text-foreground/35"><LockKeyhole className="size-3.5" />Holder access</span>}
      </div>

      {!authenticated ? (
        <div className="mt-6 flex items-start gap-3 rounded border border-foreground/10 bg-foreground/[0.02] p-4"><ShieldCheck className="mt-0.5 size-4 shrink-0 text-culture/70" /><p className="text-xs leading-5 text-foreground/38">Sign in and verify a wallet in your Research Passport to check the 0.05% holder threshold. Public PONS evidence remains available to everyone.</p></div>
      ) : access?.active ? (
        <div className="mt-6">
          <div className="flex flex-wrap items-center justify-between gap-3 rounded border border-signal/18 bg-signal/[0.035] p-4"><div><p className="font-mono text-[7px] uppercase tracking-[0.12em] text-signal">Green flag confirmed</p><p className="mt-1 text-xs text-foreground/40">Verified at block {access.blockNumber?.toLocaleString() ?? "—"} · {access.providerCount} provider quorum</p></div><Button type="button" onClick={() => void openInterpretation()} disabled={status === "loading"} className="border border-signal/28 bg-signal/[0.09] font-mono text-[7px] uppercase tracking-[0.1em] text-signal hover:bg-signal/[0.14]"><BrainCircuit />{status === "loading" ? "Reading field" : brief ? "Refresh interpretation" : "Open interpretation"}</Button></div>
          {status === "failed" ? <p className="mt-3 font-mono text-[7px] uppercase tracking-[0.1em] text-danger/80">{error}</p> : null}
          {brief ? <div className="mt-4 grid gap-3 lg:grid-cols-[1.15fr_.85fr]"><article className="rounded border border-foreground/10 bg-[var(--surface-1)]/70 p-5"><p className="font-mono text-[7px] uppercase tracking-[0.14em] text-culture">Current read · {brief.confidence} confidence</p><h4 className="specimen-serif mt-3 text-2xl leading-tight text-foreground/86">{brief.headline}</h4><p className="mt-3 text-sm leading-6 text-foreground/42">{brief.readout}</p><p className="mt-5 font-mono text-[7px] uppercase tracking-[0.1em] text-foreground/24">Through block {brief.throughBlock.toLocaleString()}</p></article><div className="grid gap-3"><article className="rounded border border-foreground/10 bg-[var(--surface-1)]/70 p-4"><p className="font-mono text-[7px] uppercase tracking-[0.14em] text-foreground/42">Observed</p><ul className="mt-3 space-y-2">{brief.observations.map((item) => <li key={item} className="text-xs leading-5 text-foreground/40">{item}</li>)}</ul></article><article className="rounded border border-attention/14 bg-attention/[0.025] p-4"><p className="font-mono text-[7px] uppercase tracking-[0.14em] text-attention">Watchpoints</p><ul className="mt-3 space-y-2">{brief.watchpoints.map((item) => <li key={item} className="text-xs leading-5 text-foreground/40">{item}</li>)}</ul></article></div></div> : null}
        </div>
      ) : (
        <div className="mt-6 flex flex-col gap-3 rounded border border-foreground/10 bg-foreground/[0.02] p-4 sm:flex-row sm:items-center sm:justify-between"><div><p className="font-mono text-[7px] uppercase tracking-[0.12em] text-foreground/45">Premium is locked</p><p className="mt-1 text-xs leading-5 text-foreground/35">{access?.reason ?? "Link and verify a wallet to check holder access."}</p></div><span className="inline-flex items-center gap-2 font-mono text-[7px] uppercase tracking-[0.1em] text-foreground/28"><RefreshCw className="size-3" />Check in Passport</span></div>
      )}
    </section>
  );
}
