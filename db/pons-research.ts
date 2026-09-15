import { getD1 } from "@/db";
import type { PonsLaunchView, PonsStateResponse, PonsTokenEvidence } from "@/lib/pons/model";
import { PONS_PAIR_BY_SYMBOL } from "@/lib/pons/constants";
import { PONS_SIGNAL_WINDOW_BLOCKS, ponsMomentumPercent } from "@/lib/pons/signals";
import { applyResearchPolicy } from "@/lib/pons/research";
import { cachedTokenIdentities } from "@/db/token-discovery";

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
    .bind(evidence.tokenAddress, now, now + (evidence.observedAt ? 300_000 : 60_000), JSON.stringify(evidence)).run();
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
    ORDER BY
      CASE
        WHEN ? IS NOT NULL THEN 0
        WHEN COALESCE(a.recent_trades, 0) >= 12
          AND COALESCE(a.recent_actors, 0) >= 5
          AND COALESCE(a.previous_trades, 0) >= 6
          AND COALESCE(a.previous_actors, 0) >= 3
          AND COALESCE(a.recent_trades, 0) * 2 >= COALESCE(a.previous_trades, 0)
          THEN 0
        WHEN COALESCE(a.recent_trades, 0) >= 12
          AND COALESCE(a.recent_actors, 0) >= 5 THEN 1
        ELSE 2
      END,
      COALESCE(r.checked_at, 0) ASC,
      COALESCE(a.recent_trades, 0) DESC,
      COALESCE(a.recent_actors, 0) DESC,
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
  return applyResearchPolicy({ ...state,
    launches: state.launches.map((launch) => {
      const row = byAddress.get(launch.tokenAddress);
      let evidence: PonsTokenEvidence | null = null;
      try { evidence = row?.payload_json ? JSON.parse(row.payload_json) : null; } catch { /* Invalid evidence stays unavailable. */ }
      const identity = identities.get(launch.tokenAddress);
      return { ...launch, name: row?.token_name || identity?.name || "Name unresolved", symbol: row?.token_symbol || identity?.symbol || "—", imageUrl: identity?.imageUrl ?? null, currentEvidence: evidence };
    }),
    tape: state.tape.map((event) => ({ ...event, tokenSymbol: byAddress.get(event.tokenAddress)?.token_symbol || identities.get(event.tokenAddress)?.symbol || "—" })),
  });
}
