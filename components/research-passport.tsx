"use client";

import { useState } from "react";
import {
  BadgeCheck,
  Bookmark,
  Cable,
  CircleDollarSign,
  Fingerprint,
  KeyRound,
  LockKeyhole,
  RefreshCw,
  ShieldCheck,
  WalletCards,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import type { PassportResponse } from "@/lib/entitlements/client";

type EthereumProvider = {
  request(input: { method: string; params?: unknown[] }): Promise<unknown>;
};

const number = new Intl.NumberFormat("en-US");

function short(value: string) {
  return `${value.slice(0, 6)}…${value.slice(-4)}`;
}

function provider() {
  return (window as unknown as { ethereum?: EthereumProvider }).ethereum;
}

export function ResearchPassport({
  passport,
  localWatchCount,
  onRefresh,
  onSyncWatches,
}: {
  passport: PassportResponse | null;
  localWatchCount: number;
  onRefresh: () => Promise<void>;
  onSyncWatches: () => Promise<{ synced: number; rejected: number }>;
}) {
  const [walletState, setWalletState] = useState<"idle" | "requesting" | "signing" | "linked" | "failed">("idle");
  const [syncState, setSyncState] = useState<"idle" | "syncing" | "done" | "partial" | "failed">("idle");
  const [gateState, setGateState] = useState<"idle" | "checking" | "failed">("idle");

  const linkWallet = async () => {
    const ethereum = provider();
    if (!ethereum) {
      setWalletState("failed");
      return;
    }
    setWalletState("requesting");
    try {
      const accounts = await ethereum.request({ method: "eth_requestAccounts" }) as string[];
      const address = accounts[0];
      if (!address) throw new Error("wallet_unavailable");
      const challengeResponse = await fetch("/api/entitlements/challenge", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ address }),
      });
      if (!challengeResponse.ok) throw new Error("challenge_rejected");
      const challenge = await challengeResponse.json() as { challengeId: string; message: string };
      setWalletState("signing");
      const signature = await ethereum.request({
        method: "personal_sign",
        params: [challenge.message, address],
      });
      if (typeof signature !== "string") throw new Error("signature_unavailable");
      const verifyResponse = await fetch("/api/entitlements/wallet", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ challengeId: challenge.challengeId, signature }),
      });
      if (!verifyResponse.ok) throw new Error("verification_rejected");
      await onRefresh();
      setWalletState("linked");
    } catch {
      setWalletState("failed");
    }
  };

  const syncWatches = async () => {
    setSyncState("syncing");
    try {
      const result = await onSyncWatches();
      setSyncState(result.rejected ? "partial" : "done");
      await onRefresh();
    } catch {
      setSyncState("failed");
    }
  };

  const recheckHolder = async () => {
    setGateState("checking");
    try {
      const response = await fetch("/api/entitlements/refresh", { method: "POST", headers: { accept: "application/json" } });
      if (!response.ok) throw new Error("holder_check_unavailable");
      await onRefresh();
      setGateState("idle");
    } catch {
      setGateState("failed");
    }
  };

  if (!passport) {
    return (
      <section id="passport" className="passport-ledger grid min-h-64 place-items-center rounded-[9px] border border-foreground/10 bg-[var(--surface-1)]/90 p-8 text-center">
        <div><RefreshCw className="mx-auto size-5 animate-spin text-culture/55" /><p className="mt-4 font-mono text-[8px] uppercase tracking-[0.16em] text-foreground/32">Opening research passport</p></div>
      </section>
    );
  }

  if (!passport.authenticated) {
    return (
      <section id="passport" className="passport-ledger relative overflow-hidden rounded-[9px] border border-culture/18 bg-[var(--surface-1)]/92 p-5 sm:p-7">
        <div className="grid gap-7 lg:grid-cols-[1fr_.85fr] lg:items-end">
          <div>
            <div className="flex items-center gap-2"><Fingerprint className="size-4 text-culture" /><p className="font-mono text-[8px] uppercase tracking-[0.18em] text-culture">Research Passport · entitlement v1</p></div>
            <h3 className="specimen-serif mt-3 text-4xl leading-[1.04] tracking-[-0.035em] text-foreground/90">Carry your field notes between devices.</h3>
            <p className="mt-4 max-w-2xl text-sm leading-7 text-foreground/38">Sign in to receive five durable Watchtower slots. A verified wallet can open Premium Interpretation when it meets the 0.05% holder threshold; public evidence stays open.</p>
          </div>
          <div className="rounded border border-foreground/10 bg-[var(--surface-depth)]/70 p-4">
            <a href={passport.signInPath} target="_top" className="flex items-center justify-center gap-2 rounded border border-culture/30 bg-culture/[0.075] px-4 py-3 font-mono text-[8px] uppercase tracking-[0.14em] text-culture transition hover:bg-culture/[0.12]"><KeyRound className="size-3.5" />Sign in to open Passport</a>
            <p className="mt-3 text-center font-mono text-[6px] uppercase tracking-[0.09em] text-foreground/20">Public signals, rankings and evidence remain open</p>
          </div>
        </div>
      </section>
    );
  }

  const { entitlements, wallets } = passport;
  const primaryWallet = wallets.find((wallet) => wallet.primary) ?? wallets[0];
  const capacities = [
    { label: "Server watches", key: "server_watch_slots" as const, icon: Bookmark },
    { label: "Alert routes", key: "alert_routes" as const, icon: Cable },
    { label: "Reports / month", key: "reports_monthly" as const, icon: BadgeCheck },
    { label: "API calls / month", key: "api_requests_monthly" as const, icon: LockKeyhole },
  ];

  return (
    <section id="passport" className="passport-ledger relative overflow-hidden rounded-[9px] border border-culture/20 bg-[var(--surface-1)]/94 p-5 sm:p-7">
      <div className="grid gap-6 xl:grid-cols-[.82fr_1.18fr]">
        <div className="flex flex-col justify-between">
          <div>
            <div className="flex flex-wrap items-center gap-2"><Fingerprint className="size-4 text-culture" /><p className="font-mono text-[8px] uppercase tracking-[0.18em] text-culture">Research Passport · {entitlements.plan} plan</p><span className="rounded border border-signal/16 bg-signal/[0.03] px-2 py-1 font-mono text-[6px] uppercase tracking-[0.1em] text-signal">active</span></div>
            <h3 className="specimen-serif mt-3 text-4xl leading-[1.04] tracking-[-0.035em] text-foreground/90">{passport.account.displayName}</h3>
            <p className="mt-2 font-mono text-[7px] uppercase tracking-[0.11em] text-foreground/23">{passport.account.email}</p>
            <p className="mt-5 max-w-xl text-sm leading-7 text-foreground/38">Your account owns the durable research state. A verified wallet can unlock Premium Interpretation at the 0.05% holder threshold; it never changes facts, scores or rankings.</p>
          </div>
          <div className="mt-6 grid gap-2 sm:grid-cols-2 xl:grid-cols-1 2xl:grid-cols-2">
            <Button type="button" variant="outline" onClick={() => void linkWallet()} disabled={walletState === "requesting" || walletState === "signing"} className="border-culture/24 bg-culture/[0.045] font-mono text-[7px] uppercase tracking-[0.11em] text-culture hover:bg-culture/[0.08]"><WalletCards />{walletState === "requesting" ? "Opening wallet" : walletState === "signing" ? "Sign ownership proof" : primaryWallet ? "Link another wallet" : "Link wallet"}</Button>
            {primaryWallet ? <Button type="button" variant="outline" onClick={() => void recheckHolder()} disabled={gateState === "checking"} className="border-signal/20 bg-signal/[0.03] font-mono text-[7px] uppercase tracking-[0.11em] text-signal hover:bg-signal/[0.07]"><ShieldCheck />{gateState === "checking" ? "Checking holder" : "Recheck holder access"}</Button> : null}
            <Button type="button" variant="outline" onClick={() => void syncWatches()} disabled={!localWatchCount || syncState === "syncing"} className="border-signal/18 bg-signal/[0.03] font-mono text-[7px] uppercase tracking-[0.11em] text-signal hover:bg-signal/[0.065]"><Bookmark />{syncState === "syncing" ? "Syncing field notes" : `Sync ${localWatchCount} device watch${localWatchCount === 1 ? "" : "es"}`}</Button>
          </div>
          <div className="mt-3 min-h-5 font-mono text-[6px] uppercase tracking-[0.09em] text-foreground/25">
            {walletState === "failed" ? "Wallet link failed or was cancelled. No transaction was sent." : walletState === "linked" ? "Wallet ownership verified." : primaryWallet ? `Primary wallet ${short(primaryWallet.address)} · Robinhood Chain ${primaryWallet.chainId}` : "Wallet signature only · no transaction · no spend approval"}
            {gateState === "failed" ? " · Holder check unavailable" : ""}
            {syncState === "done" ? " · Device watches synced" : syncState === "partial" ? " · Synced until account capacity was reached" : syncState === "failed" ? " · Watch sync unavailable" : ""}
          </div>
        </div>

        <div className="rounded border border-foreground/10 bg-[var(--surface-depth)]/72 p-4 sm:p-5">
          <div className="flex items-center justify-between gap-3"><div><p className="font-mono text-[8px] uppercase tracking-[0.16em] text-foreground/45">Research access</p><p className="mt-1 text-[10px] leading-5 text-foreground/27">Your account capacity and holder status are checked server-side.</p></div><CircleDollarSign className="size-4 text-culture/65" /></div>
          <div className="mt-5 grid gap-px overflow-hidden rounded border border-foreground/10 bg-foreground/10 sm:grid-cols-2">
            {capacities.map(({ label, key, icon: Icon }) => {
              const allowance = entitlements.allowances[key];
              const used = entitlements.used[key];
              return <div key={key} className="bg-[var(--surface-2)] p-4"><div className="flex items-center justify-between"><p className="font-mono text-[7px] uppercase tracking-[0.11em] text-foreground/27">{label}</p><Icon className="size-3.5 text-culture/60" /></div><p className="mt-3 font-mono text-xl text-foreground/78">{number.format(entitlements.remaining[key])}<span className="ml-1 text-[7px] uppercase tracking-[0.08em] text-foreground/22">left</span></p><p className="mt-1 font-mono text-[6px] uppercase tracking-[0.08em] text-foreground/18">{number.format(used)} used · {number.format(allowance)} allowance</p></div>;
            })}
          </div>
          <div className={`mt-3 flex gap-3 rounded border p-3 ${passport.premiumAccess.active ? "border-signal/24 bg-signal/[0.045]" : "border-culture/15 bg-culture/[0.03]"}`}><ShieldCheck className={`mt-0.5 size-4 shrink-0 ${passport.premiumAccess.active ? "text-signal" : "text-culture"}`} /><div><p className={`font-mono text-[7px] uppercase tracking-[0.12em] ${passport.premiumAccess.active ? "text-signal" : "text-culture"}`}>{passport.premiumAccess.active ? "Premium Interpretation · active" : `Premium Interpretation · ${passport.premiumAccess.status.replace("_", " ")}`}</p><p className="mt-1 text-[10px] leading-5 text-foreground/31">{passport.premiumAccess.reason}</p>{passport.premiumAccess.active ? <p className="mt-2 font-mono text-[7px] uppercase tracking-[0.09em] text-signal/70">0.05% threshold · block {passport.premiumAccess.blockNumber?.toLocaleString() ?? "—"}</p> : null}</div></div>
          <div className="mt-3 flex flex-wrap gap-1.5">{passport.publicGuarantees.map((item) => <span key={item} className="rounded border border-signal/13 bg-signal/[0.025] px-2 py-1 font-mono text-[6px] uppercase tracking-[0.09em] text-signal/70">{item} · public</span>)}</div>
        </div>
      </div>
    </section>
  );
}
