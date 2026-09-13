"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { arrivingFactoryEvents, FACTORY_COLLECT_INTERVAL_MS, FACTORY_READ_INTERVAL_MS, latestFactoryFeed } from "@/lib/pons/factory-feed";
import type { PonsFactoryFeed } from "@/lib/pons/model";

export function useFactoryStream(initial: PonsFactoryFeed | null | undefined) {
  const [feed, setFeed] = useState<PonsFactoryFeed | null>(initial ?? null);
  const current = useRef(feed);
  const [newIds, setNewIds] = useState<string[]>([]);
  const [checking, setChecking] = useState(false);
  const [paused, setPaused] = useState(false);
  const [error, setError] = useState(false);
  const [checkedAt, setCheckedAt] = useState<number | null>(null);
  const refreshRef = useRef<() => void>(() => undefined);
  const accept = useCallback((incoming: PonsFactoryFeed | null | undefined) => {
    const latest = latestFactoryFeed(current.current, incoming);
    if (!latest || latest === current.current) return;
    const arrivals = arrivingFactoryEvents(current.current, latest);
    if (arrivals.length) setNewIds(arrivals);
    current.current = latest;
    setFeed(latest);
  }, []);
  useEffect(() => { accept(initial); }, [initial, accept]);
  useEffect(() => {
    if (!newIds.length) return;
    const timeout = window.setTimeout(() => setNewIds([]), 8_000);
    return () => window.clearTimeout(timeout);
  }, [newIds]);
  useEffect(() => {
    let active = true;
    let reading = false;
    let collecting = false;
    let collectingArchive = false;
    let readRequest: AbortController | null = null;
    let collectRequest: AbortController | null = null;
    let archiveRequest: AbortController | null = null;
    let lastDispatch = 0;
    let lastArchiveDispatch = 0;
    const read = async () => {
      if (!active || reading || document.visibilityState !== "visible") return;
      reading = true;
      const request = new AbortController(); readRequest = request;
      const timeout = window.setTimeout(() => request.abort(), 20_000);
      setChecking(true);
      try {
        const response = await fetch("/api/pons-feed", { signal: request.signal, cache: "no-store" });
        if (!response.ok) throw new Error("feed_unavailable");
        const result = await response.json() as { feed: PonsFactoryFeed | null };
        if (active) { accept(result.feed); setCheckedAt(Date.now()); setError(false); }
      } catch { if (active && document.visibilityState === "visible") setError(true); }
      finally { window.clearTimeout(timeout); reading = false; if (active) setChecking(false); }
    };
    const collect = async () => {
      if (!active || collecting || document.visibilityState !== "visible" || Date.now() - lastDispatch < FACTORY_COLLECT_INTERVAL_MS) return;
      collecting = true; lastDispatch = Date.now();
      const request = new AbortController(); collectRequest = request;
      const timeout = window.setTimeout(() => request.abort(), 10_000);
      try { await fetch("/api/collector/live", { method: "POST", signal: request.signal }); }
      catch { /* The next read retains the last confirmed events and their real age. */ }
      finally { window.clearTimeout(timeout); collecting = false; }
    };
    // An active visit also wakes the bounded archive lane. The server's shared
    // lease prevents visitors from duplicating a commit; this is not a cron.
    const collectArchive = async () => {
      if (!active || collectingArchive || document.visibilityState !== "visible" || Date.now() - lastArchiveDispatch < 20_000) return;
      collectingArchive = true; lastArchiveDispatch = Date.now();
      const request = new AbortController(); archiveRequest = request;
      const timeout = window.setTimeout(() => request.abort(), 10_000);
      try { await fetch("/api/collector/heartbeat", { method: "POST", signal: request.signal }); }
      catch { /* The next visit or scheduled run can retry the same archive range. */ }
      finally { window.clearTimeout(timeout); collectingArchive = false; }
    };
    const visibility = () => {
      const hidden = document.visibilityState !== "visible";
      setPaused(hidden);
      if (hidden) { readRequest?.abort(); collectRequest?.abort(); archiveRequest?.abort(); }
      else { void read(); void collect(); void collectArchive(); }
    };
    refreshRef.current = () => { void read(); void collect(); };
    visibility();
    const poll = window.setInterval(read, FACTORY_READ_INTERVAL_MS);
    const dispatch = window.setInterval(collect, FACTORY_COLLECT_INTERVAL_MS);
    const archiveDispatch = window.setInterval(collectArchive, 20_000);
    document.addEventListener("visibilitychange", visibility);
    return () => {
      active = false; readRequest?.abort(); collectRequest?.abort(); archiveRequest?.abort(); refreshRef.current = () => undefined;
      window.clearInterval(poll); window.clearInterval(dispatch); window.clearInterval(archiveDispatch);
      document.removeEventListener("visibilitychange", visibility);
    };
  }, [accept]);
  const refresh = useCallback(() => refreshRef.current(), []);
  return { feed, newIds, checking, paused, error, checkedAt, refresh };
}
export type FactoryStream = ReturnType<typeof useFactoryStream>;
