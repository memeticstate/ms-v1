"use client";

import { useEffect, useState } from "react";
import { Check, Copy, ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { StateGlyph } from "@/components/state-glyph";
import { MEMETIC_TOKEN_ADDRESS, MEMETIC_TOKEN_EXPLORER_URL } from "@/lib/memetic-token";
import type { PonsLaunchView } from "@/lib/pons/model";

const steps = [
  { target: "freshness", title: "First, check the evidence", text: "A recent collection can still contain old blocks. Read the live lag before interpreting any change. Delayed data describes the indexed window, not what is happening now." },
  { target: "navigation", title: "Choose an investigation", text: "Signals finds changes in activity. Atlas groups launches by quote asset. Lifecycle traces onchain events. Evidence shows coverage and reconciliation. A quote-asset relationship is not stock ownership or backing." },
  { target: "reading", title: "Busy is not the same as alive", text: "Select a launch to read what happened, what it might mean, and what to investigate next. Two activity windows are a short-horizon observation—not proof of sustained culture or organic demand." },
  { target: "navigation", title: "Watch, then remember", text: "Save a launch and revisit whether participation broadens and activity persists. A Chain Block should preserve a selected event, its exact evidence, a dated interpretation, and uncertainty. Automatic permanent onchain archiving is not active here." },
];

export function GuideTour({ onStart }: { onStart: () => void }) {
  const [step, setStep] = useState<number | null>(null);
  const [copyState, setCopyState] = useState<"idle" | "copied" | "failed">("idle");
  useEffect(() => {
    if (copyState === "idle") return;
    const timer = window.setTimeout(() => setCopyState("idle"), 2_000);
    return () => window.clearTimeout(timer);
  }, [copyState]);
  const copyContract = async () => {
    try { await navigator.clipboard.writeText(MEMETIC_TOKEN_ADDRESS); setCopyState("copied"); }
    catch { setCopyState("failed"); }
  };
  const start = () => {
    try { localStorage.setItem("memetic-field-guide-seen-v2", "true"); } catch { /* Device preference only. */ }
    onStart();
    setStep(-1);
  };
  useEffect(() => {
    // Remember the introduction on this device, including an outside-click dismissal.
    try {
      // A landing-page evidence link should open its token, not a competing tour.
      if (new URLSearchParams(window.location.search).get("inspect") === "1") return;
      if (localStorage.getItem("memetic-field-guide-seen-v2")) return;
      const timer = window.setTimeout(start, 0);
      return () => window.clearTimeout(timer);
    } catch { /* Manual entry remains available when storage is blocked. */ }
  // The first visit is a mount event, independent of navigation callback identity.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    if (step === null || step < 0) return;
    const target = document.querySelector<HTMLElement>(`[data-guide="${steps[step].target}"]`);
    target?.setAttribute("data-guide-highlight", "true");
    target?.scrollIntoView({ behavior: "instant", block: "center" });
    return () => target?.removeAttribute("data-guide-highlight");
  }, [step]);
  return <>
    <Button variant="outline" onClick={start}>Field guide</Button>
    <Dialog open={step !== null} onOpenChange={(open) => { if (!open) setStep(null); }}>
      <DialogContent className="guide-dialog border-attention/30 bg-[var(--surface-popover)] sm:max-w-xl">
        {step === -1 ? <>
          <div className="flex items-center gap-4"><StateGlyph className="size-16 shrink-0" /><div><p className="text-2xl font-bold tracking-tight">MEMETIC <em className="specimen-serif font-normal text-culture">State</em></p><p className="mt-1 font-medium text-xs tracking-normal text-muted-foreground">A field guide to attention</p></div></div>
          <DialogTitle className="mt-2 text-2xl">Welcome to the field.</DialogTitle>
          <DialogDescription className="text-base leading-7">Memetic State is non-traditional, experimental software for independent attention intelligence on Robinhood Chain. Explore what changed, inspect the evidence, and form your own reading.</DialogDescription>
          <div className="min-w-0 rounded-lg border border-attention/20 bg-attention/5 p-4">
            <p className="font-mono text-xs uppercase tracking-wider text-attention">Token contract · Robinhood Chain</p>
            <p className="mt-2 select-all break-all font-mono text-sm leading-6 text-foreground">{MEMETIC_TOKEN_ADDRESS}</p>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <Button type="button" size="sm" variant="outline" onClick={() => void copyContract()} aria-label="Copy Memetic State contract address">
                {copyState === "copied" ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
                <span role="status">{copyState === "copied" ? "Copied" : "Copy CA"}</span>
              </Button>
              <Button size="sm" variant="ghost" asChild><a href={MEMETIC_TOKEN_EXPLORER_URL} target="_blank" rel="noreferrer">View on explorer <ExternalLink className="size-3.5" /></a></Button>
            </div>
            {copyState === "failed" ? <p role="status" className="mt-2 text-xs text-attention">Copy unavailable. Select the address above to copy it.</p> : null}
          </div>
          <p className="text-sm text-muted-foreground">A short tour will show you where to look. Click outside or press Escape to explore on your own.</p>
        </> : <>
          <p className="text-sm text-muted-foreground">Field guide · {(step ?? 0) + 1} / {steps.length}</p>
          <DialogTitle>{steps[step ?? 0].title}</DialogTitle>
          <DialogDescription className="text-base leading-7">{steps[step ?? 0].text}</DialogDescription>
        </>}
        <div className="flex justify-between gap-3">
          <Button variant="outline" onClick={() => step === -1 ? setStep(null) : setStep((s) => Math.max(-1, (s ?? 0) - 1))}>{step === -1 ? "Explore on my own" : "Back"}</Button>
          <Button onClick={() => setStep((s) => s === steps.length - 1 ? null : (s ?? 0) + 1)}>{step === steps.length - 1 ? "Start investigating" : "Next"}</Button>
        </div>
      </DialogContent>
    </Dialog>
  </>;
}

export function FieldGuide({ onExplore, onWatch, onEvidence, onStart }: { onExplore: () => void; onWatch: () => void; onEvidence: () => void; onStart: () => void }) {
  const [more, setMore] = useState(false);
  const investigate = (action: () => void) => { setMore(false); action(); };
  return <div className="flex shrink-0 gap-2">
    <GuideTour onStart={onStart} />
    <Button variant="outline" onClick={() => setMore(true)}>More</Button>
    <Dialog open={more} onOpenChange={setMore}><DialogContent className="max-h-[85dvh] overflow-y-auto sm:max-w-2xl">
      <DialogTitle>What do you want to investigate?</DialogTitle>
      <DialogDescription>Read market relationships. Follow a change. Preserve the evidence.</DialogDescription>
      <div className="flex flex-wrap gap-2"><Button variant="outline" onClick={() => investigate(onExplore)}>Explore a stock habitat</Button><Button variant="outline" onClick={() => investigate(onWatch)}>Follow a change</Button><Button variant="outline" onClick={() => investigate(onEvidence)}>Check the evidence</Button></div>
      <div className="text-sm leading-7 text-foreground/75"><h3 className="font-semibold text-foreground">What does “alive” mean here?</h3><p className="mt-2">Busy is not the same as alive. Vitality asks whether a relationship is sustained, coherent, diverse, and generative in its context. This release measures activity, short-window persistence, and actor breadth. Coherence, novelty, and generativity are research questions—not measured scores. Addresses are not necessarily distinct people.</p><p className="mt-3">Observe → Interpret → Investigate → Express → Remember. Share a dated reading with its evidence; treat a Chain Block as a curated memory, not a trading recommendation. Permanent onchain Chain Blocks are not yet available.</p></div>
    </DialogContent></Dialog>
  </div>;
}

export function GuidedReading({ launch }: { launch: PonsLaunchView }) {
  const reading = launch.research;
  const evidence = launch.currentEvidence;
  return <section className="mt-4 rounded-lg border border-attention/25 p-4 text-sm leading-6">
    <h3 className="text-base font-semibold text-attention">{reading?.label ?? "Current relevance unverified"}</h3>
    <p className="mt-2"><strong>What happened?</strong> {launch.recentTrades} trades across {launch.recentUniqueTraders} actor addresses in the latest indexed pulse, versus {launch.previousTrades} trades in the previous pulse.</p>
    <div className="mt-2"><strong>What might it mean?</strong>{(reading?.reasons ?? ["Historical trading does not establish present attention. Current evidence is unavailable."]).map((reason) => <p key={reason} className="mt-2">{reason}</p>)}</div>
    <p className="mt-3"><strong>Investigate next:</strong> {reading?.next ?? "Inspect the current chart and holder distribution before drawing a conclusion."}</p>
    {evidence ? <div className="mt-4 border-t border-foreground/15 pt-3 text-foreground/70">
      <strong>Current ownership sample</strong>
      <p>Observed {evidence.observedAt ? new Date(evidence.observedAt).toUTCString() : "not available"}{evidence.blockNumber ? ` · block ${evidence.blockNumber}` : ""}.</p>
      <p>{evidence.meaningfulHolders ?? "Unknown"} of {evidence.holderSampleSize} sampled wallets retain ≥0.01% of supply. This samples indexed actors, not the full holder list; contracts and reserves are excluded.</p>
      <p>Identified reserves: {evidence.reserveSharePercent === null ? "unknown" : `${evidence.reserveSharePercent.toFixed(2)}%`}. Creator balance: {evidence.deployerSharePercent === null ? "unknown" : `${evidence.deployerSharePercent.toFixed(3)}%`} of supply.</p>
      <p>Creator balance alone does not prove selling; transfers and other wallets may exist.</p>
      <p className="mt-2">{evidence.social.status === "ok" ? `${evidence.social.mentions} sampled matching X posts from ${evidence.social.authors} accounts in 24h. Not a measure of organic reach.` : "X activity is not verified. No social-attention score is inferred."}</p>
      {evidence.twitterUrl ? <a href={evidence.twitterUrl} target="_blank" rel="noreferrer" className="underline">Registered X profile <ExternalLink className="inline size-3" aria-hidden="true" /></a> : null}
      {evidence.social.posts.map((post) => <a key={post.url} href={post.url} target="_blank" rel="noreferrer" className="mt-1 block underline">Source post · {new Date(post.createdAt).toUTCString()} <ExternalLink className="inline size-3" aria-hidden="true" /></a>)}
    </div> : <p className="mt-3 text-foreground/60">Ownership and social evidence have not been verified. Missing evidence is not a zero score or proof of abandonment.</p>}
    <details className="mt-3 text-foreground/60"><summary>How this reading is decided</summary><p>Current signals require a fresh reconciled index, two active pulses, retained sampled holders and no measured severe outflow. Mature-pool activity is withheld until reconstructed. These conservative thresholds are provisional research filters, not calibrated probabilities or investment ratings.</p></details>
  </section>;
}
