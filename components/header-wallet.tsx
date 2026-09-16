"use client";
import { useEffect, useState } from "react";
import { Check, Copy, ExternalLink, Fingerprint, LogOut, Wallet } from "lucide-react";
import { useMemeticAuth } from "@/components/memetic-auth-provider";
import type { PassportResponse } from "@/lib/entitlements/client";
import { MEMETIC_TOKEN_ADDRESS, MEMETIC_TOKEN_EXPLORER_URL } from "@/lib/memetic-token";

export function HeaderWallet({ passport, onAccount }: { passport: PassportResponse | null; onAccount: () => void }) {
  const { ready, authenticated, signIn, linkWallet, signOut, loginState, walletLinkState } = useMemeticAuth();
  const [copyState, setCopyState] = useState<"idle" | "copied" | "failed">("idle");
  const [accountOpen, setAccountOpen] = useState(false);
  useEffect(() => {
    if (copyState === "idle") return;
    const timeout = window.setTimeout(() => setCopyState("idle"), 2_000);
    return () => window.clearTimeout(timeout);
  }, [copyState]);
  const copyContract = async () => {
    try { await navigator.clipboard.writeText(MEMETIC_TOKEN_ADDRESS); setCopyState("copied"); }
    catch { setCopyState("failed"); }
  };
  const wallet = authenticated && passport?.authenticated && passport.authProvider === "privy"
    ? passport.wallets.find((item) => item.primary) ?? passport.wallets[0] : null;
  return <div className="flex items-center gap-2">
    <div className="relative flex h-9 items-center rounded border border-attention/25 bg-attention/[0.035]">
      <button type="button" onClick={() => void copyContract()} title={MEMETIC_TOKEN_ADDRESS}
        aria-label={`Copy Memetic State contract address ${MEMETIC_TOKEN_ADDRESS}`}
        className="flex h-full items-center gap-2 rounded-l px-2.5 transition hover:bg-attention/10 focus-visible:outline-2 focus-visible:outline-attention">
        <span className="font-mono text-[9px] uppercase tracking-[0.12em] text-attention">CA</span>
        <span className="text-xs">Copy CA</span>
        {copyState === "copied" ? <Check className="size-3 text-signal" /> : <Copy className="size-3 text-attention" />}
      </button>
      <a href={MEMETIC_TOKEN_EXPLORER_URL} target="_blank" rel="noreferrer" aria-label="View Memetic State token contract on block explorer" title="View token contract"
        className="grid h-full place-items-center rounded-r border-l border-attention/20 px-2 text-attention transition hover:bg-attention/10 focus-visible:outline-2 focus-visible:outline-attention"><ExternalLink className="size-3" /></a>
      {copyState !== "idle" ? <span role="status" className="absolute left-0 top-full mt-1 whitespace-nowrap rounded border border-foreground/10 bg-[var(--surface-popover)] px-2 py-1 text-[10px] text-signal">{copyState === "copied" ? "Contract address copied" : "Copy unavailable · open explorer"}</span> : null}
    </div>
    <div className="relative">
      <button type="button" disabled={!ready} onClick={!authenticated ? signIn : wallet ? () => setAccountOpen((open) => !open) : linkWallet}
        className="flex h-9 items-center gap-2 rounded border border-signal/40 bg-signal/10 px-3 text-xs font-semibold text-signal transition hover:border-signal/70 hover:bg-signal/20 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-signal disabled:opacity-50"
        aria-expanded={wallet ? accountOpen : undefined}
        aria-haspopup={wallet ? "menu" : undefined}
        aria-label={!authenticated ? "Sign in with Privy and connect wallet" : wallet ? "Open wallet account menu" : "Link a wallet with Privy"}>
        <Wallet className="size-3.5" /><span>{wallet ? `${wallet.address.slice(0, 6)}…${wallet.address.slice(-4)}` : authenticated ? "Link wallet" : "Connect wallet"}</span>
      </button>
      {wallet && accountOpen ? <div role="menu" className="absolute right-0 top-full z-50 mt-1 min-w-52 overflow-hidden rounded border border-foreground/12 bg-[var(--surface-popover)] p-1 shadow-xl">
        <button type="button" role="menuitem" onClick={() => { setAccountOpen(false); onAccount(); }} className="flex w-full items-center gap-2 rounded px-3 py-2 text-left font-mono text-[10px] uppercase tracking-[0.1em] text-foreground/75 transition hover:bg-foreground/5"><Fingerprint className="size-3.5 text-culture" />Research Passport</button>
        <button type="button" role="menuitem" onClick={() => { setAccountOpen(false); linkWallet(); }} className="flex w-full items-center gap-2 rounded px-3 py-2 text-left font-mono text-[10px] uppercase tracking-[0.1em] text-foreground/75 transition hover:bg-foreground/5"><Wallet className="size-3.5 text-culture" />Link another wallet</button>
        <button type="button" role="menuitem" onClick={() => { setAccountOpen(false); void signOut(); }} className="flex w-full items-center gap-2 rounded px-3 py-2 text-left font-mono text-[10px] uppercase tracking-[0.1em] text-muted-foreground transition hover:bg-danger/5 hover:text-danger"><LogOut className="size-3.5" />Sign out</button>
      </div> : null}
      {!authenticated && loginState === "error" || authenticated && !wallet && walletLinkState === "error" ? <span role="status" className="absolute right-0 top-full mt-1 whitespace-nowrap rounded bg-[var(--surface-popover)] px-2 py-1 text-[10px] text-attention">Connection incomplete · try again</span> : null}
    </div>
    {authenticated && !wallet ? <button type="button" onClick={onAccount} aria-label="Open Research Passport" className="rounded border border-foreground/10 p-2 text-signal"><Fingerprint className="size-4" /></button> : null}
  </div>;
}
