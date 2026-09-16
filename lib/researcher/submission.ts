import { z } from "zod";

export type ModelOutput = {
  type: string;
  name?: string;
  call_id?: string;
  arguments?: string;
}[];
export type RepairBudget = { remaining: number };

/** Validate every entry before trimming. Invalid extra entries must not disappear unchecked. */
export function capped<T extends z.ZodTypeAny>(item: T, max: number, min = 0) {
  return z.array(item).min(min).transform(items => items.slice(0, max));
}

/** Check raw submissions before shape repair or trimming, including discarded findings. */
export function assertCitations(value: unknown, fields: string[], allowed: Set<string>, code: string) {
  if (!value || typeof value !== "object") return;
  for (const field of fields) {
    const findings = (value as Record<string, unknown>)[field];
    if (!Array.isArray(findings)) continue;
    for (const finding of findings) {
      const ids = finding && typeof finding === "object" ? finding.sourceIds : null;
      if (Array.isArray(ids) && ids.some(id => typeof id === "string" && !allowed.has(id))) {
        throw new Error(code);
      }
    }
  }
}

/** One formatting correction within the existing stage deadline; semantic failures never retry. */
export async function validatedSubmission<T extends z.ZodTypeAny>(options: {
  output: ModelOutput;
  input: unknown[];
  name: string;
  prefix: "analysis" | "review";
  schema: T;
  guard: (value: unknown) => void;
  request: (input: unknown[]) => Promise<ModelOutput>;
  deadline: number;
  repairBudget?: RepairBudget;
}): Promise<z.infer<T>> {
  const budget = options.repairBudget ?? { remaining: 1 };
  let output = options.output;
  for (let attempt = 0; ; attempt++) {
    const calls = output.filter(item => item.type === "function_call");
    const call = calls[0];
    if (calls.length !== 1 || call.name !== options.name || !call.arguments || !call.call_id) {
      throw new Error(`${options.prefix}_invalid_call`);
    }
    let value: unknown;
    try { value = JSON.parse(call.arguments); }
    catch { throw new Error(`${options.prefix}_invalid_arguments`); }
    options.guard(value);
    const parsed = options.schema.safeParse(value);
    if (parsed.success) return parsed.data;
    if (attempt || budget.remaining < 1 || options.deadline - Date.now() < 4_000) {
      throw new Error(`${options.prefix}_invalid_shape`);
    }
    budget.remaining--;
    // Only schema codes and paths are returned; Zod messages may echo untrusted values.
    const problems = parsed.error.issues.slice(0, 4).map(issue => ({
      path: issue.path.join(".").slice(0, 120), code: issue.code,
    }));
    output = await options.request([
      ...options.input,
      ...output, // Includes the reasoning items required by the Responses protocol.
      { type: "function_call_output", call_id: call.call_id, output: JSON.stringify({
        error: "invalid_submission", problems,
        instruction: "Resubmit the same call once with the required shape and nonempty required lists. Keep the same claims, citations and thesis. Do not invent evidence.",
      }) },
    ]);
  }
}
