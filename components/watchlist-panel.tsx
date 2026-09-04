"use client";

import {
  Activity,
  BellRing,
  Bookmark,
  Eye,
  GitBranch,
  RadioTower,
  Trash2,
  TrendingUp,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import type { PonsLaunchView } from "@/lib/pons/model";
import type { WatchEntry, WatchRules } from "@/lib/pons/watchlist";

const integer = new Intl.NumberFormat("en-US");

function relativeTime(value: string) {
  const seconds = Math.max(0, Math.round((Date.now() - new Date(value).getTime()) / 1_000));
  if (seconds < 60) return `${seconds}s ago`;
  if (seconds < 3_600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86_400) return `${Math.floor(seconds / 3_600)}h ago`;
  return `${Math.floor(seconds / 86_400)}d ago`;
}

function updateThreshold(value: string) {
  return value === "off" ? null : Number(value);
}

function RuleSwitch({ label, checked, onCheckedChange }: { label: string; checked: boolean; onCheckedChange: (checked: boolean) => void }) {
  return (
    <label className="flex items-center justify-between gap-3 rounded border border-foreground/8 bg-foreground/[0.018] px-3 py-2.5">
      <span className="font-mono text-[7px] uppercase tracking-[0.1em] text-foreground/38">{label}</span>
      <Switch checked={checked} onCheckedChange={onCheckedChange} aria-label={label} />
    </label>
  );
}

export function WatchlistPanel({ entries, launches, onInspect, onRulesChange, onRemove, onReadAll, storageMode = "device", syncMessage = null }: {
  entries: WatchEntry[];
  launches: PonsLaunchView[];
  onInspect: (launch: PonsLaunchView) => void;
  onRulesChange: (tokenAddress: string, rules: WatchRules) => void;
  onRemove: (tokenAddress: string) => void;
  onReadAll: () => void;
  storageMode?: "device" | "passport";
  syncMessage?: string | null;
}) {
  const launchesByAddress = new Map(launches.map((launch) => [launch.tokenAddress.toLowerCase(), launch]));
  const unread = entries.reduce((total, entry) => total + entry.alerts.filter((item) => !item.read).length, 0);
  const rules = entries.reduce((total, entry) => total
    + Number(entry.rules.signalChange)
    + Number(entry.rules.lifecycleChange)
    + Number(entry.rules.activityThreshold !== null)
    + Number(entry.rules.momentumThreshold !== null), 0);

  if (!entries.length) {
    return (
      <section className="watchlist-empty grid min-h-[520px] place-items-center overflow-hidden rounded-[9px] border border-foreground/10 bg-[var(--surface-1)]/86 px-5 py-16 text-center">
        <div className="max-w-xl">
          <div className="mx-auto grid size-16 place-items-center rounded-full border border-attention/20 bg-attention/[0.045]"><Bookmark className="size-6 text-attention" /></div>
          <p className="mt-6 font-mono text-[8px] uppercase tracking-[0.2em] text-attention">Research watchlist</p>
          <h2 className="specimen-serif mt-3 text-4xl tracking-[-0.035em] text-foreground/88">Save the launches you would otherwise keep checking manually.</h2>
          <p className="mx-auto mt-4 max-w-lg text-sm leading-7 text-foreground/36">Open a launch in Signals or Atlas and select <strong className="font-medium text-foreground/58">Save research</strong>. Memetic State will compare each new verified pulse against your rules while this observatory is open.</p>
          <p className="mt-5 font-mono text-[7px] uppercase tracking-[0.11em] text-foreground/20">{storageMode === "passport" ? "Passport ready · your next five field notes can persist across devices" : "Saved on this device · sign in from Network to add cross-device slots"}</p>
        </div>
      </section>
    );
  }

  return (
    <div className="space-y-3">
      <section className="rounded-[9px] border border-foreground/10 bg-[var(--surface-1)]/86 p-4 sm:p-5">
        <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
          <div>
            <div className="flex items-center gap-2"><Bookmark className="size-3.5 text-attention" /><p className="font-mono text-[9px] uppercase tracking-[0.2em] text-attention">Research watchlist</p></div>
            <h2 className="specimen-serif mt-2 text-3xl tracking-[-0.035em] text-foreground/88">Your saved PONS field notes.</h2>
            <p className="mt-2 text-xs leading-5 text-foreground/32">Rules run against each verified refresh while the observatory is open. Signed-in Passport watches also persist across devices; background delivery remains a later, usage-gated service.</p>
          </div>
          <div className="flex items-center gap-2">
            <span className="rounded border border-foreground/10 bg-foreground/[0.025] px-3 py-2 font-mono text-[7px] uppercase tracking-[0.11em] text-foreground/34">{storageMode === "passport" ? "Passport sync" : "This device"}</span>
            <span className="rounded border border-foreground/10 bg-foreground/[0.025] px-3 py-2 font-mono text-[7px] uppercase tracking-[0.11em] text-foreground/34">{entries.length} saved · {rules} rules</span>
            {unread ? <Button type="button" variant="outline" size="sm" onClick={onReadAll} className="border-signal/20 bg-signal/[0.035] font-mono text-[7px] uppercase tracking-[0.1em] text-signal"><BellRing />Mark {unread} read</Button> : null}
          </div>
        </div>
      </section>

      {syncMessage ? <div role="status" className="rounded border border-culture/14 bg-culture/[0.025] px-3 py-2 font-mono text-[7px] uppercase tracking-[0.1em] text-culture/75">{syncMessage}</div> : null}

      <div className="grid gap-3 xl:grid-cols-2">
        {entries.map((entry) => {
          const launch = launchesByAddress.get(entry.tokenAddress.toLowerCase());
          const unreadAlerts = entry.alerts.filter((item) => !item.read);
          return (
            <article key={entry.tokenAddress} className="watch-card relative overflow-hidden rounded-[9px] border border-foreground/10 bg-[var(--surface-2)]/88">
              <div className="absolute inset-x-0 top-0 h-px" style={{ background: `linear-gradient(90deg, transparent, ${entry.pairColor}, transparent)` }} />
              <div className="flex items-start justify-between gap-4 border-b border-foreground/8 p-4 sm:p-5">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2"><span className="rounded border px-2 py-1 font-mono text-[7px] uppercase tracking-[0.12em]" style={{ color: entry.pairColor, borderColor: `color-mix(in srgb, ${entry.pairColor} 30%, transparent)`, backgroundColor: `color-mix(in srgb, ${entry.pairColor} 6%, transparent)` }}>{entry.pairSymbol} habitat</span>{unreadAlerts.length ? <span className="inline-flex items-center gap-1.5 rounded border border-signal/20 bg-signal/[0.035] px-2 py-1 font-mono text-[7px] uppercase tracking-[0.1em] text-signal"><i className="size-1 rounded-full bg-current" />{unreadAlerts.length} new</span> : null}</div>
                  <h3 className="mt-3 truncate text-lg font-semibold text-foreground/80">{entry.name}</h3>
                  <p className="mt-1 font-mono text-[8px] uppercase tracking-[0.14em] text-foreground/27">{entry.symbol} · saved {relativeTime(entry.savedAt)}</p>
                </div>
                <div className="flex gap-1.5">
                  {launch ? <Button type="button" variant="outline" size="icon-sm" onClick={() => onInspect(launch)} aria-label={`Inspect ${entry.name}`} title="Open dossier" className="border-foreground/10 bg-foreground/[0.025] text-foreground/38 hover:text-signal"><Eye /></Button> : null}
                  <Button type="button" variant="outline" size="icon-sm" onClick={() => onRemove(entry.tokenAddress)} aria-label={`Remove ${entry.name} from watchlist`} title="Remove watch" className="border-foreground/10 bg-foreground/[0.025] text-foreground/28 hover:border-culture/30 hover:text-culture"><Trash2 /></Button>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-px bg-foreground/[0.07] sm:grid-cols-4">
                {[
                  ["Signal", launch?.signal ?? entry.lastSeen.signal],
                  ["Recent trades", integer.format(launch?.recentTrades ?? entry.lastSeen.recentTrades)],
                  ["Momentum", `${launch?.momentumPercent ?? entry.lastSeen.momentumPercent ?? "—"}%`],
                  ["Lifecycle", launch?.phase ?? entry.lastSeen.phase],
                ].map(([label, value]) => <div key={label} className="bg-[var(--surface-2)] px-3 py-3"><p className="font-mono text-[6px] uppercase tracking-[0.12em] text-foreground/20">{label}</p><p className="mt-1 truncate font-mono text-[9px] uppercase text-foreground/55">{value}</p></div>)}
              </div>

              <div className="grid gap-2 p-4 sm:grid-cols-2 sm:p-5">
                <RuleSwitch label="Signal changes" checked={entry.rules.signalChange} onCheckedChange={(checked) => onRulesChange(entry.tokenAddress, { ...entry.rules, signalChange: checked })} />
                <RuleSwitch label="Lifecycle changes" checked={entry.rules.lifecycleChange} onCheckedChange={(checked) => onRulesChange(entry.tokenAddress, { ...entry.rules, lifecycleChange: checked })} />
                <label className="rounded border border-foreground/8 bg-foreground/[0.018] px-3 py-2.5"><span className="mb-2 flex items-center gap-1.5 font-mono text-[7px] uppercase tracking-[0.1em] text-foreground/38"><Activity className="size-3 text-attention" />Activity crosses</span><Select value={entry.rules.activityThreshold === null ? "off" : String(entry.rules.activityThreshold)} onValueChange={(value) => onRulesChange(entry.tokenAddress, { ...entry.rules, activityThreshold: updateThreshold(value) })}><SelectTrigger aria-label={`Activity rule for ${entry.symbol}`} size="sm" className="w-full border-foreground/10 bg-foreground/[0.025] font-mono text-[8px] text-foreground/55"><SelectValue /></SelectTrigger><SelectContent className="border-foreground/10 bg-[var(--surface-popover)] text-foreground/70"><SelectItem value="off">Rule off</SelectItem><SelectItem value="10">10 recent trades</SelectItem><SelectItem value="25">25 recent trades</SelectItem><SelectItem value="50">50 recent trades</SelectItem><SelectItem value="100">100 recent trades</SelectItem></SelectContent></Select></label>
                <label className="rounded border border-foreground/8 bg-foreground/[0.018] px-3 py-2.5"><span className="mb-2 flex items-center gap-1.5 font-mono text-[7px] uppercase tracking-[0.1em] text-foreground/38"><TrendingUp className="size-3 text-signal" />Momentum crosses</span><Select value={entry.rules.momentumThreshold === null ? "off" : String(entry.rules.momentumThreshold)} onValueChange={(value) => onRulesChange(entry.tokenAddress, { ...entry.rules, momentumThreshold: updateThreshold(value) })}><SelectTrigger aria-label={`Momentum rule for ${entry.symbol}`} size="sm" className="w-full border-foreground/10 bg-foreground/[0.025] font-mono text-[8px] text-foreground/55"><SelectValue /></SelectTrigger><SelectContent className="border-foreground/10 bg-[var(--surface-popover)] text-foreground/70"><SelectItem value="off">Rule off</SelectItem><SelectItem value="25">+25%</SelectItem><SelectItem value="50">+50%</SelectItem><SelectItem value="100">+100%</SelectItem><SelectItem value="200">+200%</SelectItem></SelectContent></Select></label>
              </div>

              <div className="border-t border-foreground/8 px-4 py-3 sm:px-5">
                {entry.alerts.length ? <div className="space-y-2">{entry.alerts.slice(0, 3).map((item) => <div key={item.id} className={`flex gap-3 rounded border px-3 py-2.5 ${item.read ? "border-foreground/7 bg-foreground/[0.012]" : "border-signal/14 bg-signal/[0.025]"}`}><span className={`mt-1 size-1.5 shrink-0 rounded-full ${item.read ? "bg-foreground/16" : "bg-signal"}`} /><div className="min-w-0"><p className="text-[10px] font-medium text-foreground/55">{item.title}</p><p className="mt-1 truncate font-mono text-[7px] uppercase tracking-[0.08em] text-foreground/24">{item.detail} · {relativeTime(item.observedAt)}</p></div></div>)}</div> : <div className="flex items-center gap-2 font-mono text-[7px] uppercase tracking-[0.1em] text-foreground/20"><RadioTower className="size-3" />No rule crossings observed since this launch was saved</div>}
                {!launch ? <div className="mt-3 flex gap-2 rounded border border-culture/12 bg-culture/[0.025] p-3 text-[10px] leading-5 text-foreground/28"><GitBranch className="mt-0.5 size-3.5 shrink-0 text-culture" />This launch is outside the current ranked result window. Its saved rules and last verified state remain on this device.</div> : null}
              </div>
            </article>
          );
        })}
      </div>
    </div>
  );
}
