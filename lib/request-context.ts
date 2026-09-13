import { AsyncLocalStorage } from "node:async_hooks";

// Worker isolates outlive individual requests. Never let a new invocation await
// I/O promises owned by an earlier, possibly canceled invocation.
const context = new AsyncLocalStorage<Map<string, unknown>>();
export function withRequestContext<T>(work: () => T): T {
  return context.run(new Map(), work);
}
export function requestCache<T>(key: string, create: () => T): T {
  const values = context.getStore();
  if (!values) return create();
  if (!values.has(key)) values.set(key, create());
  return values.get(key) as T;
}
