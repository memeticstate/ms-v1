import { safeTokenImage, tokenAddress } from './model';

// Presentation-only enrichment. Never infer identity from a ticker or update evidence.
export function createTokenIconResolver(fetcher: typeof fetch = (...args) => fetch(...args), now = () => Date.now()) {
  const cache = new Map<string, { source: string | null; expiresAt: number }>();
  const pending = new Map<string, Promise<string | null>>();
  const queue: Array<() => void> = [];
  let active = 0;
  const drain = () => {
    while (active < 3 && queue.length) { active++; queue.shift()!(); }
  };
  return (input: string): Promise<string | null> => {
    const address = tokenAddress(input);
    if (!address) return Promise.resolve(null);
    const cached = cache.get(address);
    if (cached && cached.expiresAt > now()) return Promise.resolve(cached.source);
    const existing = pending.get(address);
    if (existing) return existing;
    // Bound queued work as well as completed metadata in long browsing sessions.
    if (pending.size >= 64) return Promise.resolve(null);
    const task = new Promise<string | null>(resolve => {
      queue.push(() => {
        void (async () => {
          let source: string | null = null;
          try {
            const response = await fetcher(`/api/token-lookup?token=${address}`, { signal: AbortSignal.timeout(15_000) });
            if (response.ok) {
              const result = await response.json() as { token?: { tokenAddress?: string; imageUrl?: unknown } | null };
              if (tokenAddress(result.token?.tokenAddress ?? '') === address) source = safeTokenImage(result.token?.imageUrl);
            }
          } catch { /* Initials remain available when metadata is unavailable. */ }
          finally {
            if (cache.size >= 256) cache.delete(cache.keys().next().value!);
            cache.set(address, { source, expiresAt: now() + (source ? 300_000 : 60_000) });
            pending.delete(address); active--; resolve(source); drain();
          }
        })();
      });
    });
    pending.set(address, task); drain();
    return task;
  };
}

export const resolveTokenIcon = createTokenIconResolver();
