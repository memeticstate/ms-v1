import { getD1 } from "@/db";
import { PremiumRequestError } from "@/lib/entitlements/premium-boundary";
import { CASE_LIMIT, type CaseFields, type CaseQuery, type CaseEvidence, type ResearchCase, type CaseSummary } from "@/lib/premium/cases";

type Row = { id: string; user_id: string; token_address: string; title: string; thesis: string; invalidation_note: string; outcome_note: string; status: CaseFields["status"]; query_json: string; original_evidence_json: string; latest_review_json: string | null; version: number; created_at: number; updated_at: number; reviewed_at: number | null };
const time = (seconds: number) => new Date(seconds * 1000).toISOString();
const summary = (row: Row): CaseSummary => ({ id: row.id, tokenAddress: row.token_address, title: row.title, status: row.status, version: row.version, createdAt: time(row.created_at), updatedAt: time(row.updated_at), reviewedAt: row.reviewed_at === null ? null : time(row.reviewed_at) });

export async function listResearchCases(userId: string) {
  const rows = await getD1().prepare(`SELECT id, token_address, title, status, version, created_at, updated_at, reviewed_at
    FROM premium_cases WHERE user_id = ? ORDER BY updated_at DESC, id ASC LIMIT ?`).bind(userId, CASE_LIMIT).all<Row>();
  return rows.results.map(summary);
}

export async function readResearchCase(userId: string, id: string): Promise<ResearchCase> {
  const row = await getD1().prepare(`SELECT * FROM premium_cases WHERE user_id = ? AND id = ?`).bind(userId, id).first<Row>();
  if (!row) throw new PremiumRequestError(404, "case_not_found");
  return { ...summary(row), thesis: row.thesis, invalidationNote: row.invalidation_note, outcomeNote: row.outcome_note, query: JSON.parse(row.query_json), original: JSON.parse(row.original_evidence_json), latestReview: row.latest_review_json ? JSON.parse(row.latest_review_json) : null };
}

export async function createResearchCase(userId: string, input: CaseFields & { id: string; query: CaseQuery }, evidence: CaseEvidence) {
  const now = Math.floor(Date.now() / 1000);
  const result = await getD1().prepare(`INSERT INTO premium_cases
    (id, user_id, token_address, title, thesis, invalidation_note, outcome_note, status, query_json, original_evidence_json, version, created_at, updated_at)
    SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?
    WHERE (SELECT COUNT(*) FROM premium_cases WHERE user_id = ?) < ?
    ON CONFLICT(id) DO NOTHING`).bind(input.id, userId, evidence.dossier.token.address, input.title, input.thesis, input.invalidationNote, input.outcomeNote, input.status,
      JSON.stringify(input.query), JSON.stringify(evidence), now, now, userId, CASE_LIMIT).run();
  if ((result.meta?.changes ?? 0) !== 1) {
    const existing = await getD1().prepare(`SELECT id FROM premium_cases WHERE user_id = ? AND id = ?`).bind(userId, input.id).first();
    if (!existing) throw new PremiumRequestError(409, "case_capacity_or_id_conflict");
  }
  return readResearchCase(userId, input.id);
}

export async function updateResearchCase(userId: string, id: string, version: number, input: CaseFields) {
  await readResearchCase(userId, id);
  const result = await getD1().prepare(`UPDATE premium_cases SET title = ?, thesis = ?, invalidation_note = ?, outcome_note = ?, status = ?, version = version + 1, updated_at = ?
    WHERE user_id = ? AND id = ? AND version = ?`).bind(input.title, input.thesis, input.invalidationNote, input.outcomeNote, input.status, Math.floor(Date.now() / 1000), userId, id, version).run();
  if ((result.meta?.changes ?? 0) !== 1) throw new PremiumRequestError(409, "case_changed_reload");
  return readResearchCase(userId, id);
}

export async function reviewResearchCase(userId: string, id: string, version: number, evidence: CaseEvidence) {
  await readResearchCase(userId, id);
  const now = Math.floor(Date.now() / 1000);
  const result = await getD1().prepare(`UPDATE premium_cases SET latest_review_json = ?, reviewed_at = ?, updated_at = ?, version = version + 1
    WHERE user_id = ? AND id = ? AND version = ?`).bind(JSON.stringify(evidence), now, now, userId, id, version).run();
  if ((result.meta?.changes ?? 0) !== 1) throw new PremiumRequestError(409, "case_changed_reload");
  return readResearchCase(userId, id);
}

export async function deleteResearchCase(userId: string, id: string, version: number) {
  await readResearchCase(userId, id);
  const result = await getD1().prepare(`DELETE FROM premium_cases WHERE user_id = ? AND id = ? AND version = ?`).bind(userId, id, version).run();
  if ((result.meta?.changes ?? 0) !== 1) throw new PremiumRequestError(409, "case_changed_reload");
}
