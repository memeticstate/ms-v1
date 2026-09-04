import { z } from "zod";

import { getD1 } from "@/db";
import { recordEngineAlert, recordSourceObservation, resolveEngineAlert } from "@/db/engine-ledger";
import type { Habitat, RobinhoodQuote } from "@/lib/affinity-model";
import { fetchJsonWithPolicy, upstreamErrorCode } from "@/lib/ingestion/resilient-fetch";

const ASSETS_URL = "https://api.robinhood.com/rhj/assets";
const PRICES_URL = "https://api.robinhood.com/rhj/prices";
const ACTIONS_URL = "https://api.robinhood.com/rhj/corporate-actions";
const ROBINHOOD_CHAIN_ID = 4663;
const REGISTRY_REFRESH_MS = 55 * 60 * 1000;
const QUOTE_FRESHNESS_MS = 5 * 60 * 1000;
const QUOTE_FALLBACK_MAX_AGE_MS = 6 * 60 * 60 * 1000;

const deploymentSchema = z.object({
  contractAddress: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
  chainId: z.number().int(),
  networkName: z.string().optional(),
});

const assetSchema = z.object({
  id: z.string().min(3),
  tokenSymbol: z.string().min(1),
  tokenName: z.string().min(1),
  deployments: z.array(deploymentSchema),
  currentMultiplier: z.string().optional().default(""),
  pendingMultiplier: z.string().optional().default(""),
  pendingMultiplierEffectiveTime: z.string().datetime().optional(),
  status: z.string(),
  logoUrl: z.string().url().optional(),
  tradingCapabilities: z.unknown().optional(),
  tokenDecimals: z.number().int().optional(),
  isin: z.string().optional(),
});

const assetsSchema = z.object({ assets: z.array(assetSchema) });

const quoteSchema = z.object({
  tokenSymbol: z.string().min(1),
  deployments: z.array(deploymentSchema).optional().default([]),
  bid: z.union([z.string(), z.number()]).transform(Number).pipe(z.number().finite().nonnegative()),
  ask: z.union([z.string(), z.number()]).transform(Number).pipe(z.number().finite().nonnegative()),
  currency: z.string().optional(),
  dailyTradingVolume: z.union([z.string(), z.number()]).transform(Number).pipe(z.number().finite().nonnegative()).optional(),
  isTradingHalt: z.boolean().optional().default(false),
  generatedAt: z.string().datetime(),
});
const quotesSchema = z.object({ quotes: z.array(quoteSchema) });

const actionSchema = z.object({
  id: z.string().min(3),
  type: z.string().min(1),
  status: z.string().optional(),
  processDate: z.object({ year: z.number().int(), month: z.number().int(), day: z.number().int() }).nullable().optional(),
  tokenSymbol: z.string().optional(),
  deployments: z.array(deploymentSchema).optional(),
  details: z.record(z.string(), z.unknown()).default({}),
});
const actionsSchema = z.object({ corpActions: z.array(actionSchema) });

export type RobinhoodAsset = {
  assetUid: string;
  tokenSymbol: string;
  tokenName: string;
  status: string;
  contractAddress: string;
  chainId: number;
  currentMultiplier?: string;
  pendingMultiplier?: string;
  pendingEffectiveAt?: string;
  logoUrl?: string;
  isin?: string;
  tokenDecimals?: number;
  tradingCapabilities: unknown;
  observedAt: string;
};

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${stableStringify(item)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

async function sha256(value: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function chunks<T>(items: T[], size: number) {
  const result: T[][] = [];
  for (let index = 0; index < items.length; index += size) result.push(items.slice(index, index + size));
  return result;
}

function processDate(value: z.infer<typeof actionSchema>["processDate"]) {
  if (!value) return null;
  return `${String(value.year).padStart(4, "0")}-${String(value.month).padStart(2, "0")}-${String(value.day).padStart(2, "0")}`;
}

function tradingStatus(capabilities: unknown) {
  if (!capabilities || typeof capabilities !== "object") return "unknown";
  const serialized = JSON.stringify(capabilities);
  if (/POSITION_CLOSING_ONLY|position_closing_only/.test(serialized)) return "closing only";
  if (/TRADING_STATUS_TRADABLE|"tradable"/.test(serialized)) return "tradable";
  if (/TRADING_STATUS_UNTRADABLE|"untradable"/.test(serialized)) return "restricted";
  return "published";
}

function sectorFor(symbol: string, name: string) {
  const value = `${symbol} ${name}`.toLowerCase();
  if (/semiconductor|nvidia|amd|intel|micron|broadcom|marvell|qualcomm/.test(value)) return "Compute";
  if (/s&p|qqq|etf|fund|trust/.test(value)) return "Index terrain";
  if (/space|exploration|rocket/.test(value)) return "Private frontier";
  if (/apple|microsoft|software|cloud|salesforce|atlassian/.test(value)) return "Digital systems";
  if (/bank|capital|financial|bitcoin|crypto/.test(value)) return "Financial systems";
  if (/energy|oil|gas|nuclear|solar/.test(value)) return "Energy";
  if (/pharma|health|medical|bio/.test(value)) return "Life sciences";
  if (/tesla|motor|auto|industrial/.test(value)) return "Industrial systems";
  return "Corporate terrain";
}

function colorFor(symbol: string) {
  const palette = ["#82965d", "#9d7f48", "#b65c43", "#71858c", "#bd7845", "#909b94", "#9c665b"];
  const hash = [...symbol].reduce((sum, character) => (sum * 33 + character.charCodeAt(0)) >>> 0, 5381);
  return palette[hash % palette.length];
}

export function habitatFromAsset(asset: RobinhoodAsset, index: number, total: number): Habitat {
  const angle = (Math.PI * 2 * index) / Math.max(1, total) - Math.PI / 2;
  const radiusX = total > 10 ? 390 : 345;
  const radiusY = total > 10 ? 225 : 205;
  return {
    symbol: asset.tokenSymbol,
    name: asset.tokenName.replace(/\s*•\s*Robinhood Token$/i, "").trim(),
    sector: sectorFor(asset.tokenSymbol, asset.tokenName),
    color: colorFor(asset.tokenSymbol),
    x: Math.round(500 + Math.cos(angle) * radiusX),
    y: Math.round(310 + Math.sin(angle) * radiusY),
    contract: asset.contractAddress,
    assetUid: asset.assetUid,
    currentMultiplier: asset.currentMultiplier,
    pendingMultiplier: asset.pendingMultiplier,
    pendingEffectiveAt: asset.pendingEffectiveAt,
    tradingStatus: tradingStatus(asset.tradingCapabilities),
    logoUrl: asset.logoUrl,
  };
}

export async function loadRobinhoodAssets(): Promise<RobinhoodAsset[]> {
  const result = await getD1().prepare(`SELECT asset_uid, token_symbol, token_name, status, contract_address, chain_id,
      current_multiplier, pending_multiplier, pending_effective_at, logo_url, isin, token_decimals,
      trading_capabilities_json, observed_at
    FROM robinhood_assets WHERE chain_id = ? AND status = 'ASSET_STATUS_ACTIVE'
    ORDER BY token_symbol`).bind(ROBINHOOD_CHAIN_ID).all<{
      asset_uid: string; token_symbol: string; token_name: string; status: string; contract_address: string; chain_id: number;
      current_multiplier: string | null; pending_multiplier: string | null; pending_effective_at: number | null;
      logo_url: string | null; isin: string | null; token_decimals: number | null; trading_capabilities_json: string; observed_at: number;
    }>();
  return result.results.map((row) => ({
    assetUid: row.asset_uid,
    tokenSymbol: row.token_symbol,
    tokenName: row.token_name,
    status: row.status,
    contractAddress: row.contract_address,
    chainId: row.chain_id,
    currentMultiplier: row.current_multiplier || undefined,
    pendingMultiplier: row.pending_multiplier || undefined,
    pendingEffectiveAt: row.pending_effective_at ? new Date(row.pending_effective_at).toISOString() : undefined,
    logoUrl: row.logo_url || undefined,
    isin: row.isin || undefined,
    tokenDecimals: row.token_decimals ?? undefined,
    tradingCapabilities: JSON.parse(row.trading_capabilities_json),
    observedAt: new Date(row.observed_at).toISOString(),
  }));
}

async function registryIsFresh() {
  const row = await getD1().prepare(`SELECT MAX(observed_at) AS observed_at, COUNT(*) AS total
      FROM robinhood_assets WHERE chain_id = ? AND status = 'ASSET_STATUS_ACTIVE'`)
    .bind(ROBINHOOD_CHAIN_ID)
    .first<{ observed_at: number | null; total: number }>();
  return Boolean(row?.total && row.observed_at && Date.now() - row.observed_at < REGISTRY_REFRESH_MS);
}

async function persistAssets(rawAssets: z.infer<typeof assetSchema>[], observedAt: number) {
  const records = (await Promise.all(rawAssets.flatMap((asset) => {
    const deployment = asset.deployments.find((item) => item.chainId === ROBINHOOD_CHAIN_ID);
    if (!deployment) return [];
    return [sha256(stableStringify(asset)).then((contentHash) => ({ asset, deployment, contentHash }))];
  })));
  const db = getD1();
  if (!records.length) throw new Error("robinhood registry returned no Robinhood Chain deployments");
  for (const group of chunks(records, 75)) {
    await db.batch(group.map(({ asset, deployment, contentHash }) => db.prepare(`INSERT INTO robinhood_assets
      (asset_uid, token_symbol, token_name, status, contract_address, chain_id, current_multiplier, pending_multiplier,
       pending_effective_at, logo_url, isin, token_decimals, trading_capabilities_json, content_hash, observed_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(asset_uid) DO UPDATE SET
        token_symbol = excluded.token_symbol, token_name = excluded.token_name, status = excluded.status,
        contract_address = excluded.contract_address, chain_id = excluded.chain_id,
        current_multiplier = excluded.current_multiplier, pending_multiplier = excluded.pending_multiplier,
        pending_effective_at = excluded.pending_effective_at, logo_url = excluded.logo_url, isin = excluded.isin,
        token_decimals = excluded.token_decimals, trading_capabilities_json = excluded.trading_capabilities_json,
        updated_at = CASE WHEN robinhood_assets.content_hash <> excluded.content_hash THEN excluded.updated_at ELSE robinhood_assets.updated_at END,
        content_hash = excluded.content_hash, observed_at = excluded.observed_at`)
      .bind(
        asset.id,
        asset.tokenSymbol,
        asset.tokenName,
        asset.status,
        deployment.contractAddress.toLowerCase(),
        deployment.chainId,
        asset.currentMultiplier || null,
        asset.pendingMultiplier || null,
        asset.pendingMultiplierEffectiveTime ? new Date(asset.pendingMultiplierEffectiveTime).getTime() : null,
        asset.logoUrl ?? null,
        asset.isin ?? null,
        asset.tokenDecimals ?? null,
        JSON.stringify(asset.tradingCapabilities ?? {}),
        contentHash,
        observedAt,
        observedAt,
      )));
  }
  await db.prepare(`UPDATE robinhood_assets
    SET status = 'ASSET_STATUS_REMOVED', observed_at = ?, updated_at = ?
    WHERE chain_id = ? AND observed_at < ?`)
    .bind(observedAt, observedAt, ROBINHOOD_CHAIN_ID, observedAt)
    .run();
  return records.length;
}

async function refreshActions(runId: string) {
  const startedAt = Date.now();
  try {
    const { data, telemetry } = await fetchJsonWithPolicy<unknown>(ACTIONS_URL, { timeoutMs: 20_000, attempts: 2 });
    const parsed = actionsSchema.parse(data);
    const seenAt = Date.now();
    const db = getD1();
    const records = await Promise.all(parsed.corpActions.map(async (action) => ({
      action,
      contentHash: await sha256(stableStringify(action)),
    })));
    for (const group of chunks(records, 75)) {
      await db.batch(group.map(({ action, contentHash }) => db.prepare(`INSERT INTO robinhood_corporate_actions
        (id, token_symbol, action_type, status, process_date, first_seen_at, last_seen_at, details_json, content_hash)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET token_symbol = excluded.token_symbol, action_type = excluded.action_type,
          status = excluded.status, process_date = excluded.process_date, last_seen_at = excluded.last_seen_at,
          details_json = excluded.details_json, content_hash = excluded.content_hash`)
        .bind(
          action.id,
          action.tokenSymbol ?? null,
          action.type,
          action.status ?? null,
          processDate(action.processDate),
          seenAt,
          seenAt,
          JSON.stringify(action.details),
          contentHash,
        )));
    }
    await recordSourceObservation(runId, {
      source: "robinhood-actions",
      status: "ok",
      startedAt,
      completedAt: telemetry.completedAt,
      recordCount: records.length,
      metadata: { attempts: telemetry.attempts, cacheWindowMinutes: 60 },
    });
    return records.length;
  } catch (error) {
    await recordSourceObservation(runId, {
      source: "robinhood-actions",
      status: "failed",
      startedAt,
      completedAt: Date.now(),
      errorCode: upstreamErrorCode(error),
    }).catch(() => undefined);
    return 0;
  }
}

export async function refreshRobinhoodRegistry(runId: string, force = false) {
  if (!force && await registryIsFresh()) {
    const assets = await loadRobinhoodAssets();
    const observedAt = assets[0]?.observedAt;
    await recordSourceObservation(runId, {
      source: "robinhood-registry",
      status: "ok",
      startedAt: Date.now(),
      completedAt: Date.now(),
      freshnessMs: observedAt ? Date.now() - new Date(observedAt).getTime() : null,
      recordCount: assets.length,
      metadata: { cache: "durable-hit" },
    });
    return { assets, refreshed: false, stale: false, corporateActions: 0 };
  }

  const startedAt = Date.now();
  const { data, telemetry } = await fetchJsonWithPolicy<unknown>(ASSETS_URL, { timeoutMs: 30_000, attempts: 2 });
  const parsed = assetsSchema.parse(data);
  const observedAt = Date.now();
  const persisted = await persistAssets(parsed.assets, observedAt);
  await recordSourceObservation(runId, {
    source: "robinhood-registry",
    status: "ok",
    startedAt,
    completedAt: telemetry.completedAt,
    recordCount: persisted,
    metadata: { attempts: telemetry.attempts, received: parsed.assets.length },
  });
  const corporateActions = await refreshActions(runId);
  const assets = await loadRobinhoodAssets();

  await getD1().prepare(`UPDATE engine_alerts SET resolved_at = ?
    WHERE code = 'pending_multiplier' AND entity_type = 'robinhood-asset' AND resolved_at IS NULL
      AND entity_id NOT IN (
        SELECT token_symbol FROM robinhood_assets
        WHERE chain_id = ? AND status = 'ASSET_STATUS_ACTIVE'
          AND pending_multiplier IS NOT NULL AND pending_multiplier <> ''
      )`)
    .bind(Date.now(), ROBINHOOD_CHAIN_ID)
    .run();
  for (const asset of assets.filter((item) => item.pendingMultiplier)) {
    await recordEngineAlert({
      severity: "info",
      code: "pending_multiplier",
      entityType: "robinhood-asset",
      entityId: asset.tokenSymbol,
      message: `${asset.tokenSymbol} has a pending corporate-action multiplier.`,
      evidence: { currentMultiplier: asset.currentMultiplier, pendingMultiplier: asset.pendingMultiplier, effectiveAt: asset.pendingEffectiveAt },
    }).catch(() => undefined);
  }

  return { assets, refreshed: true, stale: false, corporateActions };
}

async function mapConcurrent<T, R>(items: T[], concurrency: number, transform: (item: T) => Promise<R>) {
  const output: R[] = new Array(items.length);
  let cursor = 0;
  async function worker() {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      output[index] = await transform(items[index]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, () => worker()));
  return output;
}

async function loadCachedQuotes(symbols: string[]) {
  if (!symbols.length) return [];
  const placeholders = symbols.map(() => "?").join(",");
  const cutoff = Date.now() - QUOTE_FALLBACK_MAX_AGE_MS;
  const result = await getD1().prepare(`SELECT q.symbol, q.generated_at, q.bid, q.ask, q.mid, q.spread_bps,
      q.daily_volume, q.halted, q.multiplier, q.token_bid, q.token_ask
    FROM robinhood_quotes q
    INNER JOIN (
      SELECT symbol, MAX(observed_at) AS observed_at FROM robinhood_quotes
      WHERE symbol IN (${placeholders}) GROUP BY symbol
    ) latest ON latest.symbol = q.symbol AND latest.observed_at = q.observed_at
    WHERE q.observed_at >= ?`)
    .bind(...symbols, cutoff)
    .all<{
      symbol: string; generated_at: number; bid: number; ask: number; mid: number; spread_bps: number;
      daily_volume: number | null; halted: number; multiplier: string | null; token_bid: number | null; token_ask: number | null;
    }>();
  const now = Date.now();
  return result.results.map((row): RobinhoodQuote => ({
    symbol: row.symbol,
    bid: row.bid,
    ask: row.ask,
    mid: row.mid,
    spreadBps: row.spread_bps,
    dailyVolume: row.daily_volume ?? undefined,
    halted: Boolean(row.halted),
    generatedAt: new Date(row.generated_at).toISOString(),
    currentMultiplier: row.multiplier ?? undefined,
    tokenBid: row.token_bid ?? undefined,
    tokenAsk: row.token_ask ?? undefined,
    freshnessMs: Math.max(0, now - row.generated_at),
  }));
}

export async function collectRobinhoodQuotes(runId: string, symbols: string[], assets: RobinhoodAsset[]) {
  const startedAt = Date.now();
  const assetBySymbol = new Map(assets.map((asset) => [asset.tokenSymbol, asset]));
  const uniqueSymbols = [...new Set(symbols)].filter((symbol) => assetBySymbol.has(symbol)).sort();
  const failures: Array<{ symbol: string; code: string }> = [];
  const results = await mapConcurrent(uniqueSymbols, 6, async (symbol) => {
    try {
      const { data } = await fetchJsonWithPolicy<unknown>(`${PRICES_URL}/${encodeURIComponent(symbol)}`, { timeoutMs: 12_000, attempts: 2 });
      const parsed = quotesSchema.parse(data);
      const quote = parsed.quotes.find((item) => item.tokenSymbol === symbol);
      if (!quote) throw new Error("quote_identity_mismatch");
      const asset = assetBySymbol.get(symbol);
      const multiplier = Number(asset?.currentMultiplier || "1");
      const generatedMs = new Date(quote.generatedAt).getTime();
      const mid = (quote.bid + quote.ask) / 2;
      const spreadBps = mid > 0 ? ((quote.ask - quote.bid) / mid) * 10_000 : 0;
      const normalized: RobinhoodQuote = {
        symbol,
        bid: quote.bid,
        ask: quote.ask,
        mid,
        spreadBps,
        dailyVolume: quote.dailyTradingVolume,
        halted: quote.isTradingHalt,
        generatedAt: quote.generatedAt,
        currentMultiplier: asset?.currentMultiplier,
        tokenBid: Number.isFinite(multiplier) ? quote.bid * multiplier : undefined,
        tokenAsk: Number.isFinite(multiplier) ? quote.ask * multiplier : undefined,
        freshnessMs: Math.max(0, Date.now() - generatedMs),
      };
      return normalized;
    } catch (error) {
      failures.push({ symbol, code: upstreamErrorCode(error) });
      return null;
    }
  });
  const liveQuotes = results.filter((item): item is RobinhoodQuote => item !== null);
  const liveSymbols = new Set(liveQuotes.map((quote) => quote.symbol));
  const cachedQuotes = await loadCachedQuotes(uniqueSymbols.filter((symbol) => !liveSymbols.has(symbol))).catch(() => []);
  const quotes = [...liveQuotes, ...cachedQuotes];
  const db = getD1();
  if (liveQuotes.length) {
    await db.batch(liveQuotes.map((quote) => db.prepare(`INSERT OR IGNORE INTO robinhood_quotes
      (symbol, observed_at, generated_at, bid, ask, mid, spread_bps, daily_volume, halted,
       multiplier, token_bid, token_ask, freshness_ms)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .bind(
        quote.symbol,
        Date.now(),
        new Date(quote.generatedAt).getTime(),
        quote.bid,
        quote.ask,
        quote.mid,
        quote.spreadBps,
        quote.dailyVolume ?? null,
        quote.halted ? 1 : 0,
        quote.currentMultiplier ?? null,
        quote.tokenBid ?? null,
        quote.tokenAsk ?? null,
        quote.freshnessMs,
      )));
  }
  const fresh = liveQuotes.filter((quote) => quote.freshnessMs <= QUOTE_FRESHNESS_MS).length;
  const status = quotes.length === 0 ? "failed" : failures.length || fresh < quotes.length ? "stale" : "ok";
  await recordSourceObservation(runId, {
    source: "robinhood-prices",
    status,
    startedAt,
    completedAt: Date.now(),
    freshnessMs: quotes.length ? Math.max(...quotes.map((quote) => quote.freshnessMs)) : null,
    recordCount: quotes.length,
    errorCode: failures.length ? "partial_quote_failure" : null,
    metadata: { requested: uniqueSymbols.length, live: liveQuotes.length, fresh, cachedFallbacks: cachedQuotes.length, failures },
  });
  await Promise.all(liveQuotes.flatMap((quote) => {
    const alerts: Promise<unknown>[] = [];
    alerts.push(quote.halted
      ? recordEngineAlert({
          severity: "critical",
          code: "underlier_trading_halt",
          entityType: "robinhood-asset",
          entityId: quote.symbol,
          message: `${quote.symbol} reports an active underlying-equity trading halt.`,
          evidence: { generatedAt: quote.generatedAt, bid: quote.bid, ask: quote.ask },
        })
      : resolveEngineAlert("underlier_trading_halt", "robinhood-asset", quote.symbol));
    alerts.push(quote.spreadBps > 100
      ? recordEngineAlert({
          severity: "warning",
          code: "wide_underlier_spread",
          entityType: "robinhood-asset",
          entityId: quote.symbol,
          message: `${quote.symbol} underlying quote spread is ${quote.spreadBps.toFixed(1)} bps.`,
          evidence: { generatedAt: quote.generatedAt, spreadBps: quote.spreadBps, bid: quote.bid, ask: quote.ask },
        })
      : resolveEngineAlert("wide_underlier_spread", "robinhood-asset", quote.symbol));
    return alerts;
  })).catch(() => undefined);
  return { quotes: new Map(quotes.map((quote) => [quote.symbol, quote])), failures };
}
