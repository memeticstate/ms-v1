"use client";

import { useCallback, useEffect, useState } from 'react';
import type { PonsFactoryFeed, PonsStateResponse } from '@/lib/pons/model';
import type { StateChangeRecord } from '@/lib/pons/simple';

// Public reads reuse the same materialized D1 evidence as the Observatory.
export function useSimpleState(token?: string) {
  const [state, setState] = useState<PonsStateResponse | null>(null);
  const [feed, setFeed] = useState<PonsFactoryFeed | null>(null);
  const [changes, setChanges] = useState<StateChangeRecord[]>([]);
  const [changesError, setChangesError] = useState(false);
  const [feedError, setFeedError] = useState(false);
  const [error, setError] = useState(false);
  const [loading, setLoading] = useState(true);
  const [revision, setRevision] = useState(0);
  const [now, setNow] = useState(Date.now());
  const refresh = useCallback(() => setRevision(value => value + 1), []);

  useEffect(() => {
    let active = true;
    let pending: AbortController | null = null;
    const read = async () => {
      if (document.hidden || pending) return;
      const controller = new AbortController(); pending = controller;
      const timeout = window.setTimeout(() => controller.abort(), 25_000);
      const get = async (url: string) => {
        const response = await fetch(url, { signal: controller.signal, cache: 'no-store' });
        if (!response.ok) throw new Error('Evidence unavailable');
        return response.json();
      };
      const results = await Promise.allSettled([
        get(`/api/pons-state?window=100000${token ? `&token=${encodeURIComponent(token)}` : ''}`),
        ...(token ? [] : [get('/api/pons-feed'), get('/api/state-changes')]),
      ]);
      window.clearTimeout(timeout); pending = null;
      if (!active) return;
      const evidence = results[0];
      if (evidence.status === 'fulfilled' && Array.isArray(evidence.value.launches)) { setState(evidence.value); setError(false); }
      else setError(true);
      if (!token) {
        const factory = results[1]; const history = results[2];
        if (factory.status === 'fulfilled') { setFeed(factory.value.feed ?? null); setFeedError(false); } else setFeedError(true);
        if (history.status === 'fulfilled' && Array.isArray(history.value.changes)) { setChanges(history.value.changes); setChangesError(false); } else setChangesError(true);
      }
      setLoading(false); setNow(Date.now());
    };
    void read();
    const timer = window.setInterval(() => { setNow(Date.now()); void read(); }, 30_000);
    const visible = () => { if (!document.hidden) { setNow(Date.now()); void read(); } };
    document.addEventListener('visibilitychange', visible);
    return () => { active = false; pending?.abort(); window.clearInterval(timer); document.removeEventListener('visibilitychange', visible); };
  }, [token, revision]);

  return { state, feed, changes, changesError, feedError, error, loading, now, refresh };
}
