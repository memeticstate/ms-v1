import { PremiumRequestError } from "@/lib/entitlements/premium-boundary";
import { cadenceMs, RESEARCH_LIMITS, type ResearchTask, type ResearchRun, type ResearchReport, type ResearchCadence, type ResearchFocus } from "@/lib/researcher/model";

type TaskRow = { id: string; user_id: string; token_address: string; question: string; focus: ResearchFocus; cadence: ResearchCadence; paused: number; created_at: number; updated_at: number; next_run_at: number | null; last_run_at: number | null };
type RunRow = { id: string; assignment_id: string; user_id: string; status: ResearchRun["status"]; requested_at: number; finished_at: number | null; report_json: string | null; error_code: string | null };
const taskView = (r: TaskRow): ResearchTask => ({ id: r.id, tokenAddress: r.token_address, question: r.question, focus: r.focus, cadence: r.cadence, paused: Boolean(r.paused), createdAt: r.created_at, updatedAt: r.updated_at, nextRunAt: r.next_run_at, lastRunAt: r.last_run_at });
const runView = (r: RunRow): ResearchRun => ({ id: r.id, assignmentId: r.assignment_id, status: r.status, requestedAt: r.requested_at, finishedAt: r.finished_at, error: r.error_code, report: r.report_json ? JSON.parse(r.report_json) : null });

/** Every user operation includes ownership in SQL; caller identity comes from Privy. */
export class ResearchStore {
  constructor(private db: D1Database) {}
  async list(userId: string) {
    const rows = await this.db.prepare("SELECT * FROM research_assignments WHERE user_id = ? ORDER BY updated_at DESC LIMIT 5").bind(userId).all<TaskRow>();
    return rows.results.map(taskView);
  }
  async task(userId: string, id: string) {
    const row = await this.db.prepare("SELECT * FROM research_assignments WHERE user_id = ? AND id = ?").bind(userId, id).first<TaskRow>();
    if (!row) throw new PremiumRequestError(404, "assignment_not_found");
    return taskView(row);
  }
  async create(userId: string, input: Pick<ResearchTask, "tokenAddress" | "question" | "focus" | "cadence">, now = Date.now()) {
    const id = crypto.randomUUID(), interval = cadenceMs(input.cadence);
    const result = await this.db.prepare(`INSERT INTO research_assignments (id,user_id,token_address,question,focus,cadence,paused,created_at,updated_at,next_run_at)
      SELECT ?,?,?,?,?,?,0,?,?,? WHERE (SELECT COUNT(*) FROM research_assignments WHERE user_id = ?) < ?`)
      .bind(id, userId, input.tokenAddress, input.question, input.focus, input.cadence, now, now, interval ? now + interval : null, userId, RESEARCH_LIMITS.assignments).run();
    if (!result.meta?.changes) throw new PremiumRequestError(409, "assignment_limit");
    return this.task(userId, id);
  }
  async update(userId: string, id: string, paused: boolean, cadence: ResearchCadence, now = Date.now()) {
    const interval = cadenceMs(cadence);
    const result = await this.db.prepare(`UPDATE research_assignments SET paused=?,cadence=?,updated_at=?,next_run_at=? WHERE user_id=? AND id=?`)
      .bind(Number(paused), cadence, now, !paused && interval ? now + interval : null, userId, id).run();
    if (!result.meta?.changes) throw new PremiumRequestError(404, "assignment_not_found");
    if (paused) await this.db.prepare("UPDATE research_runs SET status='blocked',error_code='assignment_paused',finished_at=? WHERE user_id=? AND assignment_id=? AND status='queued'").bind(now, userId, id).run();
    return this.task(userId, id);
  }
  async remove(userId: string, id: string) {
    const result = await this.db.prepare("DELETE FROM research_assignments WHERE user_id=? AND id=?").bind(userId, id).run();
    if (!result.meta?.changes) throw new PremiumRequestError(404, "assignment_not_found");
    // The separate daily usage ledger deliberately survives assignment deletion.
  }
  async runs(userId: string, id: string) {
    await this.task(userId, id);
    const rows = await this.db.prepare("SELECT * FROM research_runs WHERE user_id=? AND assignment_id=? ORDER BY requested_at DESC LIMIT 20").bind(userId, id).all<RunRow>();
    return rows.results.map(runView);
  }
  async previous(userId: string, id: string): Promise<ResearchReport | null> {
    const row = await this.db.prepare("SELECT report_json FROM research_runs WHERE user_id=? AND assignment_id=? AND report_json IS NOT NULL ORDER BY requested_at DESC LIMIT 1").bind(userId, id).first<{ report_json: string }>();
    return row ? JSON.parse(row.report_json) : null;
  }
  async usage(userId: string, now = Date.now()) {
    const row = await this.db.prepare("SELECT COUNT(*) AS count FROM entitlement_usage WHERE user_id=? AND capability='researcher_run' AND period_key=?").bind(userId, new Date(now).toISOString().slice(0, 10)).first<{ count: number }>();
    return { used: row?.count ?? 0, limit: RESEARCH_LIMITS.dailyPerHolder };
  }
  async enqueue(userId: string, id: string, now = Date.now()): Promise<string | null> {
    const runId = crypto.randomUUID(), day = new Date(now).toISOString().slice(0, 10);
    // D1 batch is transactional: quota check + run + durable usage cannot race.
    const result = await this.db.batch([
      this.db.prepare(`INSERT OR IGNORE INTO research_runs (id,assignment_id,user_id,status,requested_at)
        SELECT ?,id,user_id,'queued',? FROM research_assignments WHERE id=? AND user_id=? AND paused=0
        AND NOT EXISTS(SELECT 1 FROM research_runs WHERE assignment_id=? AND (status IN ('queued','running') OR requested_at>?))
        AND (SELECT COUNT(*) FROM entitlement_usage WHERE user_id=? AND capability='researcher_run' AND period_key=?) < ?
        AND (SELECT COUNT(*) FROM entitlement_usage WHERE capability='researcher_run' AND period_key=?) < ?`)
        .bind(runId, now, id, userId, id, now - RESEARCH_LIMITS.cooldownMs, userId, day, RESEARCH_LIMITS.dailyPerHolder, day, RESEARCH_LIMITS.dailySite),
      this.db.prepare(`INSERT INTO entitlement_usage (id,user_id,capability,units,period_key,idempotency_key,metadata_json,observed_at)
        SELECT id,user_id,'researcher_run',1,?,id,'{}',? FROM research_runs WHERE id=?`).bind(day, Math.floor(now / 1000), runId),
    ]);
    return result[0].meta?.changes ? runId : null;
  }
  async enqueueDue(now = Date.now()) {
    const rows = await this.db.prepare("SELECT * FROM research_assignments WHERE paused=0 AND next_run_at<=? ORDER BY next_run_at ASC LIMIT 2").bind(now).all<TaskRow>();
    for (const row of rows.results) {
      // Claim the due time before enqueueing, including quota-limited attempts.
      const result = await this.db.prepare("UPDATE research_assignments SET next_run_at=? WHERE id=? AND paused=0 AND next_run_at=?")
        .bind(now + (cadenceMs(row.cadence) ?? 86_400_000), row.id, row.next_run_at).run();
      if (result.meta?.changes) await this.enqueue(row.user_id, row.id, now);
    }
  }
  async claim(now = Date.now()) {
    // A terminated worker never causes an automatic paid retry.
    await this.db.prepare("UPDATE research_runs SET status='failed',error_code='check_interrupted',finished_at=? WHERE status='running' AND lease_until<?").bind(now, now).run();
    const lease = crypto.randomUUID();
    const row = await this.db.prepare(`UPDATE research_runs SET status='running',started_at=?,lease_until=?,lease_token=?
      WHERE id=(SELECT r.id FROM research_runs r JOIN research_assignments a ON a.id=r.assignment_id
        WHERE r.status='queued' AND a.paused=0 ORDER BY r.requested_at ASC LIMIT 1) AND status='queued' RETURNING *`)
      .bind(now, now + 60_000, lease).first<RunRow>();
    return row ? { id: row.id, userId: row.user_id, assignmentId: row.assignment_id, lease } : null;
  }
  async finish(job: { id: string; userId: string; assignmentId: string; lease: string }, status: ResearchRun["status"], report: ResearchReport | null, error: string | null, now = Date.now()) {
    await this.db.batch([
      this.db.prepare(`UPDATE research_runs SET status=?,report_json=?,error_code=?,finished_at=?,lease_until=NULL WHERE id=? AND user_id=? AND status='running' AND lease_token=?`)
        .bind(status, report ? JSON.stringify(report) : null, error, now, job.id, job.userId, job.lease),
      this.db.prepare(`UPDATE research_assignments SET last_run_at=?,updated_at=? WHERE id=? AND user_id=? AND EXISTS(SELECT 1 FROM research_runs WHERE id=? AND lease_token=? AND finished_at=?)`)
        .bind(now, now, job.assignmentId, job.userId, job.id, job.lease, now),
      this.db.prepare(`DELETE FROM research_runs WHERE assignment_id=? AND status NOT IN ('queued','running') AND id NOT IN
        (SELECT id FROM research_runs WHERE assignment_id=? ORDER BY requested_at DESC LIMIT 30)`)
        .bind(job.assignmentId, job.assignmentId),
    ]);
  }
}
