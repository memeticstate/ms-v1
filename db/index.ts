import { drizzle } from "drizzle-orm/d1";
import * as schema from "./schema";

let runtimeBindings: Record<string, unknown> = {};

export function setRuntimeBindings(bindings: Record<string, unknown>) {
  runtimeBindings = bindings;
}

export function getRuntimeBinding(name: string) {
  return runtimeBindings[name];
}

function runtimeDb() {
  return runtimeBindings.DB as D1Database | undefined;
}

export function getDb() {
  const binding = runtimeDb();
  if (!binding) {
    throw new Error(
      "Cloudflare D1 binding `DB` is unavailable. Set the `d1` field in .openai/hosting.json to `DB` or let your control plane inject the real binding values before using the database."
    );
  }

  return drizzle(binding, { schema });
}

export function getD1() {
  const binding = runtimeDb();
  if (!binding) throw new Error("snapshot ledger unavailable");
  return binding;
}
