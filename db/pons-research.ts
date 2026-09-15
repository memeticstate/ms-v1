import { getD1 } from "@/db";
import type { PonsLaunchView, PonsStateResponse, PonsTokenEvidence } from "@/lib/pons/model";
import { PONS_PAIR_BY_SYMBOL } from "@/lib/pons/constants";
import { PONS_SIGNAL_WINDOW_BLOCKS, ponsMomentumPercent } from "@/lib/pons/signals";
import { applyResearchPolicy } from "@/lib/pons/research";
import { cachedTokenIdentities } from "@/db/token-discovery";

import type { PonsTokenStateTransition } from "@/lib/pons/model";

export const PONS_HOLDER_REFRESH_MS = 8 * 60_000;
export const PONS_HOLDER_RETRY_MS = 3 * 60_000;

export async function acquireAuxJob(id: string, intervalMs = 30_000) {
  const db = getD1(), now = Date.now();
  await db.prepare("INSERT OR IGNORE INTO pons_aux_jobs (id, locked_until, next_at) VALUES (?, 0, 0)").bind(id).run();
  const result = await db.prepare("UPDATE pons_aux_jobs SET locked_until = ?, next_at = ? WHERE id = ? AND locked_until <= ? AND next_at <= ?")
    .bind(now + 55_000, now + intervalMs, id, now, now).run();
  return Number(result.meta?.changes) === 1;
}
export async function releaseAuxJob(id: string) {
  await getD1().prepare("UPDATE pons_aux_jobs SET locked_until = 0 WHERE id = ?").bind(id).run();
}
export async function storeTokenEvidence(evidence: PonsTokenEvidence) {
  const now = Date.now();
  await getD1().prepare(`INSERT INTO pons_token_research (token_address, checked_at, refresh_after, payload_json) VALUES (?, ?, ?, ?)
    ON CONFLICT(token_address) DO UPDATE SET checked_at = excluded.checked_at, refresh_after = excluded.refresh_after, payload_json = excluded.payload_json`)
    .bind(
      evidence.tokenAddress,
      now,
      now + (evidence.observedAt ? PONS_HOLDER_REFRESH_MS : PONS_HOLDER_RETRY_MS),
      JSON.stringify(evidence),
    ).run();
}
export const PONS_TOKEN_STATE_HEARTBEAT_MS = 60 * 60_000;

type LatestTokenStateRow = {
  token_address: string;
  observed_at: number;
  signal: string;
  eligible: number;
  phase: string;
  evidence_status: string;
  holder_qualified: number;
};

export async function recordPonsTokenStateHistory(state: PonsStateResponse) {
  // A delayed/catching-up index must never manufacture a current state change.
  if (state.mode !== "live" || state.pulse.status !== "verified") return 0;

  const launches = state.launches.slice(0, 120);
  if (!launches.length) return 0;

  const db = getD1();
  const observedAt = Number.isFinite(Date.parse(state.generatedAt))
    ? Date.parse(state.generatedAt)
    : Date.now();

  const latest = new Map<string, LatestTokenStateRow>();
  const addresses = launches.map((launch) => launch.tokenAddress);

  for (let offset = 0; offset < addresses.length; offset += 80) {
    const batch = addresses.slice(offset, offset + 80);
    const rows = await db.prepare(`
      SELECT token_address, observed_at, signal, eligible, phase, evidence_status, holder_qualified
      FROM (
        SELECT
          token_address,
          observed_at,
          signal,
          eligible,
          phase,
          evidence_status,
          holder_qualified,
          ROW_NUMBER() OVER (
            PARTITION BY token_address
            ORDER BY observed_at DESC, id DESC
          ) AS state_rank
        FROM pons_token_state_history
        WHERE token_address IN (${batch.map(() => "?").join(",")})
      )
      WHERE state_rank = 1
    `).bind(...batch).all<LatestTokenStateRow>();

    for (const row of rows.results) latest.set(row.token_address, row);
  }

  const snapshots = [];

  for (const launch of launches) {
    const reading = launch.research;
    const evidence = launch.currentEvidence ?? null;

    const signal = reading?.signal ?? launch.signal;
    const eligible = Boolean(reading?.eligible);
    const evidenceStatus = evidence?.status ?? "missing";
    const holderSampleSize = evidence?.holderSampleSize ?? null;
    const meaningfulHolders = evidence?.meaningfulHolders ?? null;
    const holderQualified = Boolean(
      holderSampleSize !== null
      && holderSampleSize >= 10
      && meaningfulHolders !== null
      && meaningfulHolders >= 10
    );

    const previous = latest.get(launch.tokenAddress);
    const changes: string[] = [];

    if (!previous) {
      changes.push("initial");
    } else {
      if (previous.signal !== signal) changes.push("signal");
      if (Boolean(previous.eligible) !== eligible) changes.push("eligibility");
      if (previous.phase !== launch.phase) changes.push("lifecycle");
      if (previous.evidence_status !== evidenceStatus) changes.push("evidence");
      if (Boolean(previous.holder_qualified) !== holderQualified) changes.push("holder-breadth");

      if (!changes.length && observedAt - previous.observed_at >= PONS_TOKEN_STATE_HEARTBEAT_MS) {
        changes.push("heartbeat");
      }
    }

    if (!changes.length) continue;

    const payload = {
      tokenAddress: launch.tokenAddress,
      symbol: launch.symbol,
      name: launch.name,
      observedAt: new Date(observedAt).toISOString(),
      indexedBlock: state.index.latestIndexedBlock,
      phase: launch.phase,
      signal,
      eligible,
      researchLabel: reading?.label ?? null,
      researchScore: reading?.score ?? null,
      researchReasons: reading?.reasons ?? [],
      watchNext: reading?.next ?? null,
      recentTrades: launch.recentTrades,
      previousTrades: launch.previousTrades,
      recentActors: launch.recentUniqueTraders,
      previousActors: launch.previousUniqueTraders ?? 0,
      momentumPercent: launch.momentumPercent,
      buyShare: launch.buyShare,
      netQuoteFlow: launch.netQuoteFlow ?? null,
      peakDrawdownPercent: launch.peakDrawdownPercent ?? null,
      evidenceStatus,
      evidenceObservedAt: evidence?.observedAt ?? null,
      holderSampleSize,
      meaningfulHolders,
      holderQualified,
      largestWalletSharePercent: evidence?.largestWalletSharePercent ?? null,
      reserveSharePercent: evidence?.reserveSharePercent ?? null,
      changeKinds: changes,
    };

    snapshots.push({
      id: `${launch.tokenAddress}:${observedAt}:${state.index.latestIndexedBlock}`,
      tokenAddress: launch.tokenAddress,
      observedAt,
      indexedBlock: state.index.latestIndexedBlock,
      phase: launch.phase,
      signal,
      eligible,
      evidenceStatus,
      holderSampleSize,
      meaningfulHolders,
      holderQualified,
      recentTrades: launch.recentTrades,
      previousTrades: launch.previousTrades,
      recentActors: launch.recentUniqueTraders,
      previousActors: launch.previousUniqueTraders ?? 0,
      changeKind: changes.join(","),
      payloadJson: JSON.stringify(payload),
    });
  }

  if (!snapshots.length) return 0;

  const statements = snapshots.map((snapshot) => db.prepare(`
    INSERT OR IGNORE INTO pons_token_state_history (
      id,
      token_address,
      observed_at,
      indexed_block,
      phase,
      signal,
      eligible,
      evidence_status,
      holder_sample_size,
      meaningful_holders,
      holder_qualified,
      recent_trades,
      previous_trades,
      recent_actors,
      previous_actors,
      change_kind,
      payload_json
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    snapshot.id,
    snapshot.tokenAddress,
    snapshot.observedAt,
    snapshot.indexedBlock,
    snapshot.phase,
    snapshot.signal,
    snapshot.eligible,
    snapshot.evidenceStatus,
    snapshot.holderSampleSize,
    snapshot.meaningfulHolders,
    snapshot.holderQualified,
    snapshot.recentTrades,
    snapshot.previousTrades,
    snapshot.recentActors,
    snapshot.previousActors,
    snapshot.changeKind,
    snapshot.payloadJson,
  ));

  for (let offset = 0; offset < statements.length; offset += 50) {
    await db.batch(statements.slice(offset, offset + 50));
  }

  return snapshots.length;
}

export async function researchCandidate(token?: string) {
  const requested = token?.toLowerCase() ?? null;
  const window = PONS_SIGNAL_WINDOW_BLOCKS;

  return getD1().prepare(`
    WITH tip AS (
      SELECT latest_safe_block AS block
      FROM pons_index_state
      WHERE id = 'pons-v2'
    ),
    activity AS (
      SELECT
        t.token_address,
        COUNT(*) AS window_trades,
        COUNT(DISTINCT t.actor_address) AS window_actors,
        SUM(CASE
          WHEN t.block_number > tip.block - ?
          THEN 1 ELSE 0 END) AS recent_trades,
        COUNT(DISTINCT CASE
          WHEN t.block_number > tip.block - ?
          THEN t.actor_address END) AS recent_actors,
        SUM(CASE
          WHEN t.block_number > tip.block - ?
            AND t.block_number <= tip.block - ?
          THEN 1 ELSE 0 END) AS previous_trades,
        COUNT(DISTINCT CASE
          WHEN t.block_number > tip.block - ?
            AND t.block_number <= tip.block - ?
          THEN t.actor_address END) AS previous_actors
      FROM pons_curve_trades t
      CROSS JOIN tip
      WHERE t.block_number > tip.block - ?
      GROUP BY t.token_address
    ),
    surfaced AS MATERIALIZED (
      SELECT l.token_address
      FROM pons_launches l
      CROSS JOIN tip
      LEFT JOIN activity a ON a.token_address = l.token_address
      WHERE l.block_number <= tip.block
      ORDER BY
        COALESCE(a.recent_trades, 0) DESC,
        COALESCE(a.window_trades, 0) DESC,
        COALESCE(a.window_actors, 0) DESC,
        l.block_number DESC
      LIMIT 120
    )
    SELECT
      l.token_address,
      l.curve_address,
      l.deployer_address
    FROM pons_launches l
    CROSS JOIN tip
    LEFT JOIN activity a ON a.token_address = l.token_address
    LEFT JOIN pons_token_research r ON r.token_address = l.token_address
    WHERE (? IS NULL OR l.token_address = ?)
      AND (r.refresh_after IS NULL OR r.refresh_after <= ?)
      AND l.block_number <= tip.block
      AND NOT EXISTS (
        SELECT 1
        FROM pons_events e
        WHERE e.token_address = l.token_address
          AND e.event_type IN ('graduation', 'sweep')
          AND e.block_number <= tip.block
      )
      AND (
        ? IS NOT NULL
        OR (
          l.token_address IN (SELECT token_address FROM surfaced)
          AND COALESCE(a.recent_trades, 0) >= 12
          AND COALESCE(a.recent_actors, 0) >= 5
          AND COALESCE(a.previous_trades, 0) >= 6
          AND COALESCE(a.previous_actors, 0) >= 3
          AND COALESCE(a.recent_trades, 0) * 2 >= COALESCE(a.previous_trades, 0)
        )
      )
    ORDER BY
      COALESCE(a.recent_trades, 0) DESC,
      COALESCE(a.recent_actors, 0) DESC,
      COALESCE(r.checked_at, 0) ASC,
      l.block_number DESC
    LIMIT 1
  `)
    .bind(
      window,
      window,
      window * 2,
      window,
      window * 2,
      window,
      window * 2,
      requested,
      requested,
      Date.now(),
      requested,
    )
    .first<{ token_address: string; curve_address: string; deployer_address: string }>();
}
export async function recentTokenActors(token: string) {
  // Sample ownership candidates from the same two pulse windows used by the
  // participation engine. A fixed "last N trades" slice can collapse to a few
  // hyperactive wallets and understate holder breadth on busy tokens.
  const rows = await getD1().prepare(`
    WITH tip AS (
      SELECT latest_safe_block AS block
      FROM pons_index_state
      WHERE id = 'pons-v2'
    )
    SELECT t.actor_address
    FROM pons_curve_trades t
    CROSS JOIN tip
    WHERE t.token_address = ?
      AND t.block_number BETWEEN tip.block - ? + 1 AND tip.block
    GROUP BY t.actor_address
    ORDER BY
      MAX(CASE WHEN t.block_number > tip.block - ? THEN 1 ELSE 0 END) DESC,
      MAX(t.block_number) DESC
    LIMIT 48
  `)
    .bind(token, PONS_SIGNAL_WINDOW_BLOCKS * 2, PONS_SIGNAL_WINDOW_BLOCKS)
    .all<{ actor_address: string }>();

  return rows.results.map((r) => r.actor_address);
}
async function archivedLaunches(addresses: string[], state: PonsStateResponse): Promise<PonsLaunchView[]> {
  if (!addresses.length) return [];
  const end = state.index.latestIndexedBlock, recent = end - PONS_SIGNAL_WINDOW_BLOCKS + 1, prior = recent - PONS_SIGNAL_WINDOW_BLOCKS;
  const rows = await getD1().prepare(`SELECT l.*, COUNT(t.id) AS trades, COUNT(DISTINCT t.actor_address) AS actors,
    SUM(t.side = 'buy') AS buys, SUM(t.side = 'sell') AS sells,
    SUM(t.block_number >= ${recent}) AS recent_trades,
    SUM(t.block_number >= ${prior} AND t.block_number < ${recent}) AS previous_trades,
    COUNT(DISTINCT CASE WHEN t.block_number >= ${recent} THEN t.actor_address END) AS recent_actors,
    COUNT(DISTINCT CASE WHEN t.block_number >= ${prior} AND t.block_number < ${recent} THEN t.actor_address END) AS prior_actors,
    SUM(t.block_number >= ${recent} AND t.side = 'buy') AS recent_buys,
    SUM(t.block_number >= ${recent} AND t.side = 'sell') AS recent_sells, MAX(t.block_timestamp) AS last_trade,
    CASE WHEN EXISTS(SELECT 1 FROM pons_events e WHERE e.token_address = l.token_address AND e.event_type = 'graduation' AND e.block_number <= ${end}) THEN 'graduated'
      WHEN EXISTS(SELECT 1 FROM pons_events e WHERE e.token_address = l.token_address AND e.event_type = 'sweep' AND e.block_number <= ${end}) THEN 'swept' ELSE 'bonding' END AS phase,
    (SELECT COUNT(*) FROM pons_launches d WHERE d.deployer_address = l.deployer_address AND d.block_number <= ${end}) AS creator_launches,
    (SELECT COUNT(DISTINCT e.token_address) FROM pons_events e JOIN pons_launches d ON d.token_address = e.token_address WHERE d.deployer_address = l.deployer_address AND e.event_type = 'graduation' AND e.block_number <= ${end}) AS creator_graduations
    FROM pons_launches l LEFT JOIN pons_curve_trades t ON t.token_address = l.token_address AND t.block_number BETWEEN ? AND ?
    WHERE l.token_address IN (${addresses.map(() => "?").join(",")}) AND l.block_number <= ? GROUP BY l.token_address`)
    .bind(state.window.fromBlock, end, ...addresses, end).all<Record<string, string | number | null>>();
  return rows.results.map((row): PonsLaunchView => {
  const n = (key: string) => Number(row[key] ?? 0), s = (key: string) => String(row[key] ?? "");
  return { tokenAddress: s("token_address"), curveAddress: s("curve_address"), deployerAddress: s("deployer_address"), pairTokenAddress: s("pair_token_address"), pairSymbol: s("pair_symbol"),
    pairColor: PONS_PAIR_BY_SYMBOL.get(s("pair_symbol"))?.color ?? "#899890", name: s("token_name") || "Name unresolved", symbol: s("token_symbol") || "—",
    blockNumber: n("block_number"), launchedAt: new Date(n("block_timestamp") * 1000).toISOString(), txHash: s("tx_hash"), launchConfigId: n("launch_config_id"), graduationThresholdRaw: s("graduation_threshold_raw"), phase: s("phase") as PonsLaunchView["phase"],
    trades: n("trades"), buys: n("buys"), sells: n("sells"), uniqueTraders: n("actors"), recentTrades: n("recent_trades"), previousTrades: n("previous_trades"), recentUniqueTraders: n("recent_actors"), previousUniqueTraders: n("prior_actors"), recentBuys: n("recent_buys"), recentSells: n("recent_sells"),
    momentumPercent: ponsMomentumPercent(n("recent_trades"), n("previous_trades")), buyShare: n("recent_trades") ? Math.round(n("recent_buys") / n("recent_trades") * 100) : 0,
    lastTradeAt: n("last_trade") ? new Date(n("last_trade") * 1000).toISOString() : null, signal: "unverified", signalNote: "Historical record; current relevance unverified.", confidence: "early", flowQuality: 0, attentionScore: 0,
    deployerLaunches: n("creator_launches"), deployerGraduations: n("creator_graduations"),
  };
  });
}

type StoredTokenState = {
  token_address: string;
  observed_at: number;
  signal: PonsActivitySignal;
  eligible: number;
  phase: string;
  evidence_status: string;
  holder_qualified: number;
  change_kind: string;
  payload_json: string;
  state_rank: number;
};

const VERIFIED_SIGNALS = new Set<PonsActivitySignal>([
  "steady",
  "broadening",
  "surging",
]);

function transitionKind(
  previous: StoredTokenState,
  current: StoredTokenState,
): PonsTokenStateTransition["kind"] {
  if (previous.phase !== current.phase) return "lifecycle";

  if (current.signal === "inactive" && previous.signal !== "inactive") {
    return "inactive";
  }

  if (current.signal === "stressed" && previous.signal !== "stressed") {
    return "deteriorated";
  }

  if (
    previous.signal === "stressed"
    && VERIFIED_SIGNALS.has(current.signal)
  ) {
    return "recovered";
  }

  if (
    !VERIFIED_SIGNALS.has(previous.signal)
    && VERIFIED_SIGNALS.has(current.signal)
  ) {
    return "strengthened";
  }

  if (
    VERIFIED_SIGNALS.has(previous.signal)
    && current.signal === "unverified"
  ) {
    return "verification-lost";
  }

  if (
    previous.signal === "stressed"
    && current.signal === "unverified"
  ) {
    return "stress-cleared";
  }

  if (previous.signal !== current.signal) return "state-change";

  if (
    previous.evidence_status !== current.evidence_status
    || Boolean(previous.holder_qualified) !== Boolean(current.holder_qualified)
    || Boolean(previous.eligible) !== Boolean(current.eligible)
  ) {
    return "evidence-update";
  }

  return "state-change";
}

function transitionLabel(kind: PonsTokenStateTransition["kind"]) {
  switch (kind) {
    case "strengthened": return "Current participation became verified";
    case "deteriorated": return "Participation moved under stress";
    case "recovered": return "Recovered from stress";
    case "verification-lost": return "Verification was lost";
    case "stress-cleared": return "Stress is no longer confirmed";
    case "inactive": return "Participation became inactive";
    case "lifecycle": return "Lifecycle changed";
    case "evidence-update": return "Evidence changed";
    default: return "State changed";
  }
}

function payloadObject(value: string) {
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object"
      ? parsed as Record<string, unknown>
      : {};
  } catch {
    return {};
  }
}

function payloadNumber(
  payload: Record<string, unknown>,
  key: string,
): number | null {
  const value = payload[key];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function payloadString(
  payload: Record<string, unknown>,
  key: string,
): string | null {
  const value = payload[key];
  return typeof value === "string" && value.trim() ? value : null;
}

function payloadStrings(
  payload: Record<string, unknown>,
  key: string,
): string[] {
  const value = payload[key];
  if (!Array.isArray(value)) return [];
  return value.filter(
    (item): item is string => typeof item === "string" && Boolean(item.trim()),
  );
}

function explainTransition(
  previous: StoredTokenState,
  current: StoredTokenState,
): PonsTokenStateTransition {
  const before = payloadObject(previous.payload_json);
  const after = payloadObject(current.payload_json);
  const kind = transitionKind(previous, current);
  const changes: string[] = [];

  if (previous.signal !== current.signal) {
    changes.push(
      `Measured state changed from ${previous.signal} to ${current.signal}.`,
    );
  }

  if (previous.phase !== current.phase) {
    changes.push(
      `Lifecycle moved from ${previous.phase} to ${current.phase}.`,
    );
  }

  if (current.signal === "stressed" || current.signal === "inactive") {
    const reasons = payloadStrings(after, "researchReasons");
    for (const reason of reasons.slice(0, 2)) {
      if (!changes.includes(reason)) changes.push(reason);
    }
  }

  if (previous.evidence_status !== current.evidence_status) {
    if (
      previous.evidence_status === "missing"
      && current.evidence_status !== "missing"
    ) {
      changes.push("Current holder evidence became available.");
    } else if (
      current.evidence_status === "missing"
      || current.evidence_status === "unavailable"
    ) {
      changes.push("Current holder evidence became unavailable.");
    } else {
      changes.push(
        `Holder evidence changed from ${previous.evidence_status} to ${current.evidence_status}.`,
      );
    }
  }

  if (
    !Boolean(previous.holder_qualified)
    && Boolean(current.holder_qualified)
  ) {
    changes.push("Sampled holder breadth crossed the verification requirement.");
  } else if (
    Boolean(previous.holder_qualified)
    && !Boolean(current.holder_qualified)
  ) {
    changes.push("Sampled holder breadth fell below the verification requirement.");
  }

  if (!Boolean(previous.eligible) && Boolean(current.eligible)) {
    changes.push("Current eligibility requirements are now satisfied.");
  } else if (Boolean(previous.eligible) && !Boolean(current.eligible)) {
    changes.push("Current eligibility requirements are no longer satisfied.");
  }

  const beforeTrades = payloadNumber(before, "recentTrades");
  const afterTrades = payloadNumber(after, "recentTrades");
  if (
    beforeTrades !== null
    && afterTrades !== null
    && beforeTrades !== afterTrades
  ) {
    const delta = beforeTrades > 0
      ? Math.abs(afterTrades - beforeTrades) / beforeTrades
      : 1;

    if (delta >= 0.25) {
      changes.push(
        afterTrades > beforeTrades
          ? `Recent trading activity expanded from ${beforeTrades} to ${afterTrades} trades.`
          : `Recent trading activity contracted from ${beforeTrades} to ${afterTrades} trades.`,
      );
    }
  }

  const beforeActors = payloadNumber(before, "recentActors");
  const afterActors = payloadNumber(after, "recentActors");
  if (
    beforeActors !== null
    && afterActors !== null
    && Math.abs(afterActors - beforeActors) >= 3
  ) {
    changes.push(
      afterActors > beforeActors
        ? `Observed actor breadth increased from ${beforeActors} to ${afterActors} addresses.`
        : `Observed actor breadth decreased from ${beforeActors} to ${afterActors} addresses.`,
    );
  }

  if (!changes.length) {
    changes.push("A material evidence condition changed since the previous recorded state.");
  }

  const fallbackWatch =
    kind === "deteriorated"
      ? "Watch whether participation stabilizes or holder breadth also begins to weaken."
      : kind === "recovered"
        ? "Watch whether the recovery persists through the next observation window."
        : kind === "verification-lost"
          ? "Watch whether participation and evidence breadth recover enough to regain verification."
          : kind === "stress-cleared"
            ? "Watch whether participation strengthens enough to regain verification or stress returns."
            : kind === "inactive"
              ? "Watch for fresh participation, retained ownership, and a new verified assessment before treating this state as reactivated."
            : kind === "strengthened"
              ? "Watch whether participation persists through the next observation window."
              : "Watch the next verified observation for confirmation or reversal.";

  return {
    observedAt: new Date(current.observed_at).toISOString(),
    previousObservedAt: new Date(previous.observed_at).toISOString(),
    from: previous.signal,
    to: current.signal,
    kind,
    label: transitionLabel(kind),
    whatChanged: changes.slice(0, 5),
    watchNext: payloadString(after, "watchNext") ?? fallbackWatch,
    changeKinds: current.change_kind.split(",").filter(Boolean),
  };
}

export async function loadPonsTokenTransitions(addresses: string[]) {
  const unique = [...new Set(addresses.map((address) => address.toLowerCase()))];
  const transitions = new Map<string, PonsTokenStateTransition>();

  for (let offset = 0; offset < unique.length; offset += 80) {
    const batch = unique.slice(offset, offset + 80);
    if (!batch.length) continue;

    const rows = await getD1().prepare(`
      SELECT *
      FROM (
        SELECT
          token_address,
          observed_at,
          signal,
          eligible,
          phase,
          evidence_status,
          holder_qualified,
          change_kind,
          payload_json,
          ROW_NUMBER() OVER (
            PARTITION BY token_address
            ORDER BY observed_at DESC, id DESC
          ) AS state_rank
        FROM pons_token_state_history
        WHERE token_address IN (${batch.map(() => "?").join(",")})
      )
      WHERE state_rank <= 2
      ORDER BY token_address, state_rank
    `).bind(...batch).all<StoredTokenState>();

    const grouped = new Map<string, StoredTokenState[]>();

    for (const row of rows.results) {
      const list = grouped.get(row.token_address) ?? [];
      list.push(row);
      grouped.set(row.token_address, list);
    }

    for (const [tokenAddress, states] of grouped) {
      const current = states.find((row) => Number(row.state_rank) === 1);
      const previous = states.find((row) => Number(row.state_rank) === 2);

      if (current && previous) {
        transitions.set(
          tokenAddress,
          explainTransition(previous, current),
        );
      }
    }
  }

  return transitions;
}

export async function decorateResearch(state: PonsStateResponse, requestedToken?: string, browse?: { pair?: string; phase?: string }) {
  if (requestedToken && /^0x[0-9a-f]{40}$/i.test(requestedToken) && !state.launches.some((l) => l.tokenAddress === requestedToken.toLowerCase())) {
    const [launch] = await archivedLaunches([requestedToken.toLowerCase()], state);
    if (launch) state = { ...state, launches: [...state.launches, launch] };
  }
  // Habitat/phase drill-downs query the ledger, rather than the global top-120 sample.
  const pair = browse?.pair && browse.pair !== "ALL" ? browse.pair : null;
  const phase = browse?.phase === "graduated" ? "graduation" : null;
  if (pair || phase) {
    const addresses = await getD1().prepare(`SELECT l.token_address FROM pons_launches l
      WHERE l.block_number <= ? AND (? IS NULL OR l.pair_symbol = ?)
        AND (? IS NULL OR EXISTS (SELECT 1 FROM pons_events e WHERE e.token_address = l.token_address AND e.event_type = ? AND e.block_number BETWEEN ? AND ?))
        AND (l.block_number >= ? OR EXISTS (SELECT 1 FROM pons_curve_trades t WHERE t.token_address = l.token_address AND t.block_number BETWEEN ? AND ?)
          OR EXISTS (SELECT 1 FROM pons_events e WHERE e.token_address = l.token_address AND e.event_type = 'graduation' AND e.block_number BETWEEN ? AND ?))
      ORDER BY l.block_number DESC LIMIT 80`).bind(state.index.latestIndexedBlock, pair, pair, phase, phase,
        state.window.fromBlock, state.index.latestIndexedBlock, state.window.fromBlock, state.window.fromBlock, state.index.latestIndexedBlock,
        state.window.fromBlock, state.index.latestIndexedBlock).all<{ token_address: string }>();
    const existing = new Set(state.launches.map((launch) => launch.tokenAddress));
    const missing = addresses.results.filter((row) => !existing.has(row.token_address));
    const extra = await archivedLaunches(missing.map((row) => row.token_address), state);
    state = { ...state, launches: [...state.launches, ...extra] };
  }
  const addresses = [...new Set([...state.launches.map((l) => l.tokenAddress), ...state.tape.map((e) => e.tokenAddress)])];
  const rows: Array<{ token_address: string; token_symbol: string | null; token_name: string | null; payload_json: string | null }> = [];
  for (let offset = 0; offset < addresses.length; offset += 80) {
    const batch = addresses.slice(offset, offset + 80);
    const result = await getD1().prepare(`SELECT l.token_address, l.token_symbol, l.token_name, r.payload_json
      FROM pons_launches l LEFT JOIN pons_token_research r ON r.token_address = l.token_address
      WHERE l.token_address IN (${batch.map(() => "?").join(",")})`).bind(...batch).all<typeof rows[number]>();
    rows.push(...result.results);
  }
  const byAddress = new Map(rows.map((row) => [row.token_address, row]));
  const identities = await cachedTokenIdentities(addresses);
  const decorated = applyResearchPolicy({ ...state,
    launches: state.launches.map((launch) => {
      const row = byAddress.get(launch.tokenAddress);
      let evidence: PonsTokenEvidence | null = null;
      try { evidence = row?.payload_json ? JSON.parse(row.payload_json) : null; } catch { /* Invalid evidence stays unavailable. */ }
      const identity = identities.get(launch.tokenAddress);
      return { ...launch, name: row?.token_name || identity?.name || "Name unresolved", symbol: row?.token_symbol || identity?.symbol || "—", imageUrl: identity?.imageUrl ?? null, currentEvidence: evidence };
    }),
    tape: state.tape.map((event) => ({ ...event, tokenSymbol: byAddress.get(event.tokenAddress)?.token_symbol || identities.get(event.tokenAddress)?.symbol || "—" })),
  });

  const transitions = await loadPonsTokenTransitions(
    decorated.launches.map((launch) => launch.tokenAddress),
  );

  return {
    ...decorated,
    launches: decorated.launches.map((launch) => ({
      ...launch,
      stateTransition: transitions.get(launch.tokenAddress) ?? null,
    })),
  };
}
