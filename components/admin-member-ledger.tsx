"use client";

import { useCallback, useEffect, useState } from "react";
import { ArrowLeft, Fingerprint, RefreshCw, ShieldCheck, WalletCards } from "lucide-react";
import Link from "next/link";

import { useMemeticAuth } from "@/components/memetic-auth-provider";
import { Button } from "@/components/ui/button";

type Member = {
  memberId: string;
  displayName: string;
  email: string | null;
  providers: string[];
  identityCount: number;
  watchCount: number;
  wallets: Array<{ address: string; primary: boolean }>;
  grants: Array<{ plan: string; source: string }>;
  createdAt: string;
  lastAuthenticatedAt: string | null;
};

function short(value: string) {
  return `${value.slice(0, 6)}…${value.slice(-4)}`;
}

export function AdminMemberLedger() {
  const { ready, authenticated, identityVersion, signIn, authFetch } = useMemeticAuth();
  const [members, setMembers] = useState<Member[]>([]);
  const [state, setState] = useState<"loading" | "ready" | "signed-out" | "forbidden" | "failed">("loading");
  const [generatedAt, setGeneratedAt] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!ready) return;
    setState("loading");
    try {
      const response = await authFetch("/api/admin/members", { headers: { accept: "application/json" } });
      if (response.status === 401) {
        setState("signed-out");
        return;
      }
      if (response.status === 403) {
        setState("forbidden");
        return;
      }
      if (!response.ok) throw new Error("member_ledger_unavailable");
      const payload = await response.json() as { members: Member[]; generatedAt: string };
      setMembers(payload.members);
      setGeneratedAt(payload.generatedAt);
      setState("ready");
    } catch {
      setState("failed");
    }
  }, [authFetch, ready]);

  useEffect(() => {
    const timer = window.setTimeout(() => void refresh(), 0);
    return () => window.clearTimeout(timer);
  }, [identityVersion, refresh]);

  return (
    <main className="min-h-screen px-4 py-5 sm:px-7 sm:py-8">
      <div className="mx-auto max-w-6xl">
        <header className="flex flex-wrap items-center justify-between gap-4 border-b border-foreground/10 pb-5">
          <div>
            <p className="font-mono text-xs uppercase tracking-[0.18em] text-culture">Private operations</p>
            <h1 className="specimen-serif mt-2 text-4xl tracking-[-0.035em] text-foreground/90">Member ledger</h1>
          </div>
          <div className="flex items-center gap-2">
            <Link href="/?view=network" className="inline-flex items-center gap-2 rounded px-3 py-2 font-mono text-xs uppercase tracking-[0.12em] text-muted-foreground hover:text-foreground/75"><ArrowLeft className="size-3.5" />Observatory</Link>
            <Button type="button" variant="outline" onClick={() => void refresh()} disabled={state === "loading"} className="border-foreground/12 bg-foreground/[0.025] font-mono text-xs uppercase tracking-[0.12em]"><RefreshCw className={state === "loading" ? "animate-spin" : ""} />Refresh</Button>
          </div>
        </header>

        {state === "signed-out" ? <section className="mt-5 grid min-h-72 place-items-center rounded-[9px] border border-culture/18 bg-[var(--surface-1)] p-8 text-center"><div><Fingerprint className="mx-auto size-7 text-culture" /><h2 className="specimen-serif mt-4 text-3xl text-foreground/88">Operator sign-in required</h2><p className="mx-auto mt-3 max-w-md text-xs leading-6 text-muted-foreground">This ledger is separate from the public observatory and is available only to configured operators.</p><Button type="button" onClick={signIn} disabled={!ready} className="mt-5 border border-culture/28 bg-culture/[0.08] font-mono text-xs uppercase tracking-[0.12em] text-culture hover:bg-culture/[0.13]">Open secure login</Button></div></section> : null}
        {state === "forbidden" ? <section className="mt-5 grid min-h-72 place-items-center rounded-[9px] border border-foreground/10 bg-[var(--surface-1)] p-8 text-center"><div><ShieldCheck className="mx-auto size-7 text-muted-foreground" /><h2 className="specimen-serif mt-4 text-3xl text-foreground/88">Operator access not granted</h2><p className="mx-auto mt-3 max-w-md text-xs leading-6 text-muted-foreground">The signed-in identity is not present in the server-side administrator allowlist.</p></div></section> : null}
        {state === "failed" ? <section className="mt-5 rounded-[9px] border border-danger/20 bg-danger/[0.035] p-6"><p className="font-mono text-xs uppercase tracking-[0.14em] text-danger">Member ledger unavailable</p><p className="mt-2 text-xs text-muted-foreground">No member data was exposed. Retry after checking the authentication configuration.</p></section> : null}

        {state === "ready" ? (
          <section className="mt-5 overflow-hidden rounded-[9px] border border-foreground/10 bg-[var(--surface-1)]">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-foreground/10 px-5 py-4"><p className="font-mono text-xs uppercase tracking-[0.16em] text-muted-foreground">{members.length} member{members.length === 1 ? "" : "s"}</p><p className="font-mono text-xs uppercase tracking-[0.1em] text-muted-foreground">Generated {generatedAt ? new Date(generatedAt).toLocaleString() : "now"}</p></div>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[820px] border-collapse text-left">
                <thead><tr className="border-b border-foreground/8 font-mono text-xs uppercase tracking-[0.12em] text-muted-foreground"><th className="px-5 py-3 font-normal">Member</th><th className="px-4 py-3 font-normal">Identity</th><th className="px-4 py-3 font-normal">Wallets</th><th className="px-4 py-3 font-normal">Research</th><th className="px-5 py-3 font-normal">Last authenticated</th></tr></thead>
                <tbody>{members.map((member) => <tr key={member.memberId} className="border-b border-foreground/7 align-top last:border-b-0"><td className="px-5 py-4"><p className="text-sm font-medium text-foreground/76">{member.displayName}</p><p className="mt-1 font-mono text-xs text-muted-foreground">{member.email ?? short(member.memberId)}</p></td><td className="px-4 py-4"><div className="flex flex-wrap gap-1">{member.providers.length ? member.providers.map((provider) => <span key={provider} className="rounded border border-culture/16 bg-culture/[0.035] px-2 py-1 font-mono text-xs uppercase tracking-[0.09em] text-culture">{provider}</span>) : <span className="font-mono text-xs text-muted-foreground">legacy</span>}</div><p className="mt-2 font-mono text-xs text-muted-foreground">{member.identityCount} linked</p></td><td className="px-4 py-4"><div className="space-y-1">{member.wallets.length ? member.wallets.map((wallet) => <p key={wallet.address} className="flex items-center gap-1.5 font-mono text-xs text-muted-foreground"><WalletCards className="size-3 text-signal/60" />{short(wallet.address)}{wallet.primary ? " · primary" : ""}</p>) : <p className="font-mono text-xs text-muted-foreground">None linked</p>}</div></td><td className="px-4 py-4"><p className="font-mono text-xs text-muted-foreground">{member.watchCount} watches</p><p className="mt-1 font-mono text-xs text-muted-foreground">{member.grants.length ? member.grants.map((grant) => `${grant.plan}/${grant.source}`).join(", ") : "field/public"}</p></td><td className="px-5 py-4 font-mono text-xs text-muted-foreground">{member.lastAuthenticatedAt ? new Date(member.lastAuthenticatedAt).toLocaleString() : "Before Privy migration"}</td></tr>)}</tbody>
              </table>
            </div>
          </section>
        ) : null}
        {state === "loading" ? <section className="mt-5 grid min-h-72 place-items-center rounded-[9px] border border-foreground/10 bg-[var(--surface-1)]"><RefreshCw className="size-5 animate-spin text-culture/60" /></section> : null}
        {!authenticated && state === "ready" ? <p className="mt-4 font-mono text-xs uppercase tracking-[0.1em] text-muted-foreground">Session state changed; refresh to revalidate operator access.</p> : null}
      </div>
    </main>
  );
}
