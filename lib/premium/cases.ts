import { z } from "zod";
import { parseResearchRequest, type ResearchDossier } from "./research";
import { PremiumRequestError } from "@/lib/entitlements/premium-boundary";

export const CASE_LIMIT = 50;
export const CASE_EVIDENCE_LIMIT = 20;
export const caseId = z.string().uuid();
export const caseFields = z.object({
  title: z.string().trim().min(1).max(120),
  thesis: z.string().trim().min(1).max(4000),
  invalidationNote: z.string().trim().min(1).max(2000),
  outcomeNote: z.string().max(4000).default(""),
  status: z.enum(["open", "supported", "invalidated", "archived"]).default("open"),
});
const querySchema = z.object({
  token: z.string().regex(/^0x[0-9a-fA-F]{40}$/),
  through: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
  window: z.union([z.literal(5000), z.literal(25000), z.literal(100000)]),
  kind: z.enum(["all", "buy", "sell", "lifecycle"]).default("all"),
  scope: z.enum(["all", "window"]).default("all"),
  cursor: z.string().regex(/^\d{1,15}:\d{1,9}$/).optional(),
});
export const createCaseInput = caseFields.extend({ id: caseId, query: querySchema, evidenceIds: z.array(z.string().min(1).max(240)).max(CASE_EVIDENCE_LIMIT).default([]) });
export const updateCaseInput = caseFields.extend({ id: caseId, version: z.number().int().positive() });
export const reviewCaseInput = z.object({ id: caseId, version: z.number().int().positive(), action: z.literal("review") });
export type CaseQuery = z.infer<typeof querySchema>;
export type CaseFields = z.infer<typeof caseFields>;
export type CaseSummary = Pick<CaseFields, "title" | "status"> & { id: string; tokenAddress: string; version: number; createdAt: string; updatedAt: string; reviewedAt: string | null };
export type CaseEvidence = { capturedAt: string; capturedRecords: number; dossier: ResearchDossier };
export type ResearchCase = CaseSummary & CaseFields & { query: CaseQuery; original: CaseEvidence; latestReview: CaseEvidence | null };

export function researchQueryForCase(query: CaseQuery, review = false) {
  const params = new URLSearchParams(Object.entries(query).filter(([, value]) => value !== undefined).map(([key, value]) => [key, String(value)]));
  if (review) { params.delete("through"); params.delete("cursor"); params.set("scope", "window"); params.set("kind", "all"); }
  return parseResearchRequest(new URL(`https://memeticstate.com/api/premium/research?${params}`));
}

export function captureCaseEvidence(dossier: ResearchDossier, evidenceIds: string[] = []): CaseEvidence {
  const unique = [...new Set(evidenceIds)];
  if (unique.length > CASE_EVIDENCE_LIMIT) throw new PremiumRequestError(422, "too_many_evidence_records");
  if (unique.some(id => !dossier.history.records.some(row => row.id === id))) throw new PremiumRequestError(409, "evidence_window_changed");
  const records = unique.length ? dossier.history.records.filter(row => unique.includes(row.id)) : dossier.history.records.slice(0, CASE_EVIDENCE_LIMIT);
  const captured = { capturedAt: new Date().toISOString(), capturedRecords: records.length, dossier: { ...dossier, history: { ...dossier.history, records, nextCursor: null } } };
  if (new TextEncoder().encode(JSON.stringify(captured)).byteLength > 65_536) throw new PremiumRequestError(422, "case_evidence_too_large");
  return captured;
}

export function compareCaseEvidence(original: CaseEvidence, latest: CaseEvidence) {
  const before = original.dossier.windows[0], after = latest.dossier.windows[0];
  const comparable = Boolean(before && after && !before.sampled && !after.sampled && original.dossier.selection.windowBlocks === latest.dossier.selection.windowBlocks);
  return { comparable, advanced: latest.dossier.coverage.throughBlock > original.dossier.coverage.throughBlock,
    trades: comparable ? after.trades - before.trades : null, wallets: comparable ? after.actors - before.actors : null,
    beforeBlock: original.dossier.coverage.throughBlock, afterBlock: latest.dossier.coverage.throughBlock,
    current: latest.dossier.coverage.current };
}

export async function readCaseBody(request: Request) {
  if (!request.headers.get("content-type")?.includes("application/json")) throw new PremiumRequestError(415, "json_required");
  if (!request.body) throw new PremiumRequestError(422, "invalid_case");
  const reader = request.body.getReader(); const chunks: Uint8Array[] = []; let length = 0;
  try {
    while (true) { const { done, value } = await reader.read(); if (done) break; length += value.byteLength;
      if (length > 24_576) { await reader.cancel(); throw new PremiumRequestError(413, "request_too_large"); } chunks.push(value); }
  } finally { reader.releaseLock(); }
  const all = new Uint8Array(length); let offset = 0; for (const chunk of chunks) { all.set(chunk, offset); offset += chunk.byteLength; }
  try { return JSON.parse(new TextDecoder().decode(all)); } catch { throw new PremiumRequestError(422, "invalid_case"); }
}
