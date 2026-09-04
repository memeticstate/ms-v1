import { sql } from "drizzle-orm";
import { index, integer, primaryKey, real, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

export const affinitySnapshots = sqliteTable("affinity_snapshots", {
  id: text("id").primaryKey(),
  observedAt: integer("observed_at").notNull(),
  generatedAt: integer("generated_at").notNull(),
  chainId: integer("chain_id").notNull(),
  blockNumber: integer("block_number").notNull(),
  blockHash: text("block_hash").notNull(),
  reconciliationStatus: text("reconciliation_status").notNull(),
  payloadJson: text("payload_json").notNull(),
  provenanceJson: text("provenance_json").notNull(),
  createdAt: integer("created_at").notNull().default(sql`(unixepoch())`),
}, (table) => [
  index("affinity_snapshots_observed_at_idx").on(table.observedAt),
  index("affinity_snapshots_block_number_idx").on(table.blockNumber),
]);

export const chainBlocks = sqliteTable("chain_blocks", {
  id: text("id").primaryKey(),
  number: integer("number").notNull().unique(),
  detectedAt: integer("detected_at").notNull(),
  snapshotId: text("snapshot_id").notNull().references(() => affinitySnapshots.id, { onDelete: "cascade" }),
  previousSnapshotId: text("previous_snapshot_id").references(() => affinitySnapshots.id, { onDelete: "set null" }),
  kind: text("kind").notNull(),
  significance: integer("significance").notNull(),
  payloadJson: text("payload_json").notNull(),
  provenanceJson: text("provenance_json").notNull(),
  createdAt: integer("created_at").notNull().default(sql`(unixepoch())`),
}, (table) => [
  index("chain_blocks_detected_at_idx").on(table.detectedAt),
  index("chain_blocks_snapshot_idx").on(table.snapshotId),
]);

export const reconciliationRecords = sqliteTable("reconciliation_records", {
  snapshotId: text("snapshot_id").notNull().references(() => affinitySnapshots.id, { onDelete: "cascade" }),
  speciesId: text("species_id").notNull(),
  contractAddress: text("contract_address").notNull(),
  launchTxHash: text("launch_tx_hash").notNull(),
  launchBlockNumber: integer("launch_block_number").notNull(),
  codeVerified: integer("code_verified", { mode: "boolean" }).notNull(),
  launchVerified: integer("launch_verified", { mode: "boolean" }).notNull(),
}, (table) => [
  primaryKey({ columns: [table.snapshotId, table.speciesId] }),
  index("reconciliation_records_contract_idx").on(table.contractAddress),
]);

export const rpcProviderObservations = sqliteTable("rpc_provider_observations", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  observedAt: integer("observed_at").notNull(),
  provider: text("provider").notNull(),
  status: text("status").notNull(),
  latencyMs: integer("latency_ms").notNull(),
  blockNumber: integer("block_number"),
  blockHash: text("block_hash"),
  errorCode: text("error_code"),
}, (table) => [
  index("rpc_provider_observations_provider_time_idx").on(table.provider, table.observedAt),
  index("rpc_provider_observations_status_time_idx").on(table.status, table.observedAt),
]);

export const collectionState = sqliteTable("collection_state", {
  id: text("id").primaryKey(),
  lockedUntil: integer("locked_until").notNull().default(0),
  lastAttemptAt: integer("last_attempt_at"),
  lastSuccessAt: integer("last_success_at"),
  lastFailureAt: integer("last_failure_at"),
  lastSnapshotId: text("last_snapshot_id"),
  lastErrorCode: text("last_error_code"),
  consecutiveFailures: integer("consecutive_failures").notNull().default(0),
});

export const speciesObservations = sqliteTable("species_observations", {
  snapshotId: text("snapshot_id").notNull().references(() => affinitySnapshots.id, { onDelete: "cascade" }),
  speciesId: text("species_id").notNull(),
  observedAt: integer("observed_at").notNull(),
  protocol: text("protocol").notNull(),
  contractAddress: text("contract_address").notNull(),
  symbol: text("symbol").notNull(),
  marketCapUsd: real("market_cap_usd").notNull(),
  volume24hUsd: real("volume_24h_usd").notNull(),
  liquidityUsd: real("liquidity_usd").notNull(),
  totalDepthUsd: real("total_depth_usd").notNull(),
  trades24h: integer("trades_24h"),
  change24h: real("change_24h").notNull(),
  affinityBalance: integer("affinity_balance").notNull(),
  marketVitality: integer("market_vitality").notNull(),
  marketStress: integer("market_stress").notNull(),
  turnover24h: real("turnover_24h").notNull(),
  depthRatio: real("depth_ratio").notNull(),
}, (table) => [
  primaryKey({ columns: [table.snapshotId, table.speciesId] }),
  index("species_observations_species_time_idx").on(table.speciesId, table.observedAt),
  index("species_observations_contract_time_idx").on(table.contractAddress, table.observedAt),
]);

export const affinityEdgeObservations = sqliteTable("affinity_edge_observations", {
  snapshotId: text("snapshot_id").notNull().references(() => affinitySnapshots.id, { onDelete: "cascade" }),
  speciesId: text("species_id").notNull(),
  habitat: text("habitat").notNull(),
  observedAt: integer("observed_at").notNull(),
  protocol: text("protocol").notNull(),
  declaredWeight: real("declared_weight"),
  strength: real("strength").notNull(),
}, (table) => [
  primaryKey({ columns: [table.snapshotId, table.speciesId, table.habitat] }),
  index("affinity_edge_observations_species_time_idx").on(table.speciesId, table.observedAt),
  index("affinity_edge_observations_habitat_time_idx").on(table.habitat, table.observedAt),
]);

export const collectionRuns = sqliteTable("collection_runs", {
  id: text("id").primaryKey(),
  trigger: text("trigger").notNull(),
  lane: text("lane").notNull(),
  status: text("status").notNull(),
  phase: text("phase").notNull(),
  startedAt: integer("started_at").notNull(),
  completedAt: integer("completed_at"),
  durationMs: integer("duration_ms"),
  snapshotId: text("snapshot_id").references(() => affinitySnapshots.id, { onDelete: "set null" }),
  discoveredSpecies: integer("discovered_species").notNull().default(0),
  observedSpecies: integer("observed_species").notNull().default(0),
  verifiedSpecies: integer("verified_species").notNull().default(0),
  warningCount: integer("warning_count").notNull().default(0),
  errorCode: text("error_code"),
  metadataJson: text("metadata_json").notNull().default("{}"),
}, (table) => [
  index("collection_runs_started_at_idx").on(table.startedAt),
  index("collection_runs_status_time_idx").on(table.status, table.startedAt),
]);

export const sourceObservations = sqliteTable("source_observations", {
  runId: text("run_id").notNull().references(() => collectionRuns.id, { onDelete: "cascade" }),
  source: text("source").notNull(),
  status: text("status").notNull(),
  startedAt: integer("started_at").notNull(),
  completedAt: integer("completed_at").notNull(),
  latencyMs: integer("latency_ms").notNull(),
  freshnessMs: integer("freshness_ms"),
  recordCount: integer("record_count").notNull().default(0),
  errorCode: text("error_code"),
  metadataJson: text("metadata_json").notNull().default("{}"),
}, (table) => [
  primaryKey({ columns: [table.runId, table.source] }),
  index("source_observations_source_time_idx").on(table.source, table.completedAt),
  index("source_observations_status_time_idx").on(table.status, table.completedAt),
]);

export const robinhoodAssets = sqliteTable("robinhood_assets", {
  assetUid: text("asset_uid").primaryKey(),
  tokenSymbol: text("token_symbol").notNull(),
  tokenName: text("token_name").notNull(),
  status: text("status").notNull(),
  contractAddress: text("contract_address").notNull(),
  chainId: integer("chain_id").notNull(),
  currentMultiplier: text("current_multiplier"),
  pendingMultiplier: text("pending_multiplier"),
  pendingEffectiveAt: integer("pending_effective_at"),
  logoUrl: text("logo_url"),
  isin: text("isin"),
  tokenDecimals: integer("token_decimals"),
  tradingCapabilitiesJson: text("trading_capabilities_json").notNull().default("{}"),
  contentHash: text("content_hash").notNull(),
  observedAt: integer("observed_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
}, (table) => [
  uniqueIndex("robinhood_assets_symbol_unique").on(table.tokenSymbol),
  uniqueIndex("robinhood_assets_contract_unique").on(table.contractAddress),
  index("robinhood_assets_status_idx").on(table.status),
]);

export const robinhoodQuotes = sqliteTable("robinhood_quotes", {
  symbol: text("symbol").notNull(),
  observedAt: integer("observed_at").notNull(),
  generatedAt: integer("generated_at").notNull(),
  bid: real("bid").notNull(),
  ask: real("ask").notNull(),
  mid: real("mid").notNull(),
  spreadBps: real("spread_bps").notNull(),
  dailyVolume: real("daily_volume"),
  halted: integer("halted", { mode: "boolean" }).notNull().default(false),
  multiplier: text("multiplier"),
  tokenBid: real("token_bid"),
  tokenAsk: real("token_ask"),
  freshnessMs: integer("freshness_ms").notNull(),
}, (table) => [
  primaryKey({ columns: [table.symbol, table.observedAt] }),
  index("robinhood_quotes_symbol_time_idx").on(table.symbol, table.observedAt),
  index("robinhood_quotes_generated_at_idx").on(table.generatedAt),
]);

export const robinhoodCorporateActions = sqliteTable("robinhood_corporate_actions", {
  id: text("id").primaryKey(),
  tokenSymbol: text("token_symbol"),
  actionType: text("action_type").notNull(),
  status: text("status"),
  processDate: text("process_date"),
  firstSeenAt: integer("first_seen_at").notNull(),
  lastSeenAt: integer("last_seen_at").notNull(),
  detailsJson: text("details_json").notNull(),
  contentHash: text("content_hash").notNull(),
}, (table) => [
  index("robinhood_corporate_actions_symbol_idx").on(table.tokenSymbol),
  index("robinhood_corporate_actions_seen_idx").on(table.lastSeenAt),
]);

export const contractAttestations = sqliteTable("contract_attestations", {
  contractAddress: text("contract_address").primaryKey(),
  speciesId: text("species_id").notNull(),
  launchTxHash: text("launch_tx_hash").notNull(),
  launchBlockNumber: integer("launch_block_number").notNull(),
  codeHash: text("code_hash").notNull(),
  codeVerified: integer("code_verified", { mode: "boolean" }).notNull(),
  launchVerified: integer("launch_verified", { mode: "boolean" }).notNull(),
  providerQuorum: integer("provider_quorum").notNull(),
  firstVerifiedAt: integer("first_verified_at").notNull(),
  lastVerifiedAt: integer("last_verified_at").notNull(),
}, (table) => [
  index("contract_attestations_species_idx").on(table.speciesId),
  index("contract_attestations_verified_at_idx").on(table.lastVerifiedAt),
]);

export const cohortMembers = sqliteTable("cohort_members", {
  contractAddress: text("contract_address").primaryKey(),
  speciesId: text("species_id").notNull(),
  symbol: text("symbol").notNull(),
  selected: integer("selected", { mode: "boolean" }).notNull().default(false),
  eligibleStreak: integer("eligible_streak").notNull().default(0),
  missStreak: integer("miss_streak").notNull().default(0),
  lastRank: integer("last_rank"),
  selectionScore: real("selection_score").notNull().default(0),
  firstSeenAt: integer("first_seen_at").notNull(),
  lastSeenAt: integer("last_seen_at").notNull(),
  selectedSince: integer("selected_since"),
  metadataJson: text("metadata_json").notNull().default("{}"),
}, (table) => [
  uniqueIndex("cohort_members_species_unique").on(table.speciesId),
  index("cohort_members_selected_rank_idx").on(table.selected, table.lastRank),
  index("cohort_members_last_seen_idx").on(table.lastSeenAt),
]);

export const engineAlerts = sqliteTable("engine_alerts", {
  id: text("id").primaryKey(),
  detectedAt: integer("detected_at").notNull(),
  severity: text("severity").notNull(),
  code: text("code").notNull(),
  entityType: text("entity_type").notNull(),
  entityId: text("entity_id").notNull(),
  message: text("message").notNull(),
  evidenceJson: text("evidence_json").notNull().default("{}"),
  snapshotId: text("snapshot_id").references(() => affinitySnapshots.id, { onDelete: "set null" }),
  resolvedAt: integer("resolved_at"),
}, (table) => [
  index("engine_alerts_detected_at_idx").on(table.detectedAt),
  index("engine_alerts_open_severity_idx").on(table.resolvedAt, table.severity),
  index("engine_alerts_entity_idx").on(table.entityType, table.entityId),
]);

export const ponsIndexState = sqliteTable("pons_index_state", {
  id: text("id").primaryKey(),
  lockedUntil: integer("locked_until").notNull().default(0),
  initializedAt: integer("initialized_at"),
  liveNextBlock: integer("live_next_block").notNull().default(0),
  backfillNextBlock: integer("backfill_next_block").notNull().default(0),
  latestSafeBlock: integer("latest_safe_block").notNull().default(0),
  latestSafeHash: text("latest_safe_hash"),
  latestSeenBlock: integer("latest_seen_block").notNull().default(0),
  lastAttemptAt: integer("last_attempt_at"),
  lastSuccessAt: integer("last_success_at"),
  lastFailureAt: integer("last_failure_at"),
  lastErrorCode: text("last_error_code"),
  consecutiveFailures: integer("consecutive_failures").notNull().default(0),
  lastRecordCount: integer("last_record_count").notNull().default(0),
});

export const ponsLaunches = sqliteTable("pons_launches", {
  tokenAddress: text("token_address").primaryKey(),
  curveAddress: text("curve_address").notNull(),
  deployerAddress: text("deployer_address").notNull(),
  pairTokenAddress: text("pair_token_address").notNull(),
  pairSymbol: text("pair_symbol").notNull(),
  pairDecimals: integer("pair_decimals").notNull(),
  launchConfigId: integer("launch_config_id").notNull(),
  graduationThresholdRaw: text("graduation_threshold_raw").notNull(),
  blockNumber: integer("block_number").notNull(),
  blockHash: text("block_hash").notNull(),
  blockTimestamp: integer("block_timestamp").notNull(),
  txHash: text("tx_hash").notNull(),
  logIndex: integer("log_index").notNull(),
  tokenName: text("token_name"),
  tokenSymbol: text("token_symbol"),
  metadataStatus: text("metadata_status").notNull().default("pending"),
  metadataUpdatedAt: integer("metadata_updated_at"),
  observedAt: integer("observed_at").notNull(),
}, (table) => [
  uniqueIndex("pons_launches_curve_unique").on(table.curveAddress),
  uniqueIndex("pons_launches_tx_log_unique").on(table.txHash, table.logIndex),
  index("pons_launches_pair_block_idx").on(table.pairSymbol, table.blockNumber),
  index("pons_launches_deployer_block_idx").on(table.deployerAddress, table.blockNumber),
  index("pons_launches_block_idx").on(table.blockNumber),
  index("pons_launches_metadata_idx").on(table.metadataStatus, table.blockNumber),
]);

export const ponsEvents = sqliteTable("pons_events", {
  id: text("id").primaryKey(),
  eventType: text("event_type").notNull(),
  tokenAddress: text("token_address").notNull(),
  emitterAddress: text("emitter_address").notNull(),
  blockNumber: integer("block_number").notNull(),
  blockHash: text("block_hash").notNull(),
  blockTimestamp: integer("block_timestamp").notNull(),
  txHash: text("tx_hash").notNull(),
  logIndex: integer("log_index").notNull(),
  dataJson: text("data_json").notNull().default("{}"),
  observedAt: integer("observed_at").notNull(),
}, (table) => [
  uniqueIndex("pons_events_tx_log_unique").on(table.txHash, table.logIndex),
  index("pons_events_type_block_idx").on(table.eventType, table.blockNumber),
  index("pons_events_token_block_idx").on(table.tokenAddress, table.blockNumber),
  index("pons_events_block_idx").on(table.blockNumber),
]);

export const ponsCurveTrades = sqliteTable("pons_curve_trades", {
  id: text("id").primaryKey(),
  curveAddress: text("curve_address").notNull(),
  tokenAddress: text("token_address").notNull(),
  side: text("side").notNull(),
  actorAddress: text("actor_address").notNull(),
  recipientAddress: text("recipient_address").notNull(),
  quoteAmountRaw: text("quote_amount_raw").notNull(),
  tokenAmountRaw: text("token_amount_raw").notNull(),
  feeRaw: text("fee_raw").notNull(),
  taxRaw: text("tax_raw").notNull(),
  blockNumber: integer("block_number").notNull(),
  blockHash: text("block_hash").notNull(),
  blockTimestamp: integer("block_timestamp").notNull(),
  txHash: text("tx_hash").notNull(),
  logIndex: integer("log_index").notNull(),
  observedAt: integer("observed_at").notNull(),
}, (table) => [
  uniqueIndex("pons_curve_trades_tx_log_unique").on(table.txHash, table.logIndex),
  index("pons_curve_trades_token_block_idx").on(table.tokenAddress, table.blockNumber),
  index("pons_curve_trades_curve_block_idx").on(table.curveAddress, table.blockNumber),
  index("pons_curve_trades_actor_block_idx").on(table.actorAddress, table.blockNumber),
  index("pons_curve_trades_block_idx").on(table.blockNumber),
]);

export const ponsActivitySnapshots = sqliteTable("pons_activity_snapshots", {
  id: text("id").primaryKey(),
  observedAt: integer("observed_at").notNull(),
  fromBlock: integer("from_block").notNull(),
  toBlock: integer("to_block").notNull(),
  headBlock: integer("head_block").notNull(),
  launchCount: integer("launch_count").notNull().default(0),
  graduationCount: integer("graduation_count").notNull().default(0),
  buyCount: integer("buy_count").notNull().default(0),
  sellCount: integer("sell_count").notNull().default(0),
  activeDeployers: integer("active_deployers").notNull().default(0),
  activeTraders: integer("active_traders").notNull().default(0),
  payloadJson: text("payload_json").notNull().default("{}"),
}, (table) => [
  index("pons_activity_snapshots_observed_idx").on(table.observedAt),
  index("pons_activity_snapshots_block_idx").on(table.toBlock),
]);

export const ponsStateCache = sqliteTable("pons_state_cache", {
  windowBlocks: integer("window_blocks").primaryKey(),
  generatedAt: integer("generated_at").notNull(),
  indexedBlock: integer("indexed_block").notNull(),
  payloadJson: text("payload_json").notNull(),
});

export const ponsGenerationIndexState = sqliteTable("pons_generation_index_state", {
  id: text("id").primaryKey(),
  factoryAddress: text("factory_address").notNull(),
  startBlock: integer("start_block").notNull(),
  launchNextBlock: integer("launch_next_block").notNull(),
  swapNextBlock: integer("swap_next_block").notNull(),
  latestSeenBlock: integer("latest_seen_block").notNull().default(0),
  lockedUntil: integer("locked_until").notNull().default(0),
  lastAttemptAt: integer("last_attempt_at"),
  lastSuccessAt: integer("last_success_at"),
  lastFailureAt: integer("last_failure_at"),
  lastErrorCode: text("last_error_code"),
  consecutiveFailures: integer("consecutive_failures").notNull().default(0),
  lastRecordCount: integer("last_record_count").notNull().default(0),
}, (table) => [
  index("pons_generation_index_progress_idx").on(table.launchNextBlock, table.swapNextBlock),
  index("pons_generation_index_success_idx").on(table.lastSuccessAt),
]);

export const ponsV1Launches = sqliteTable("pons_v1_launches", {
  tokenAddress: text("token_address").primaryKey(),
  generation: text("generation").notNull(),
  factoryAddress: text("factory_address").notNull(),
  deployerAddress: text("deployer_address").notNull(),
  dexFactoryAddress: text("dex_factory_address").notNull(),
  pairTokenAddress: text("pair_token_address").notNull(),
  pairSymbol: text("pair_symbol").notNull(),
  poolAddress: text("pool_address").notNull(),
  dexId: text("dex_id").notNull(),
  launchConfigId: text("launch_config_id").notNull(),
  positionId: text("position_id").notNull(),
  restrictionsEndBlock: text("restrictions_end_block").notNull(),
  initialBuyAmountRaw: text("initial_buy_amount_raw").notNull(),
  blockNumber: integer("block_number").notNull(),
  blockHash: text("block_hash").notNull(),
  blockTimestamp: integer("block_timestamp").notNull(),
  txHash: text("tx_hash").notNull(),
  logIndex: integer("log_index").notNull(),
  tokenName: text("token_name"),
  tokenSymbol: text("token_symbol"),
  metadataStatus: text("metadata_status").notNull().default("pending"),
  metadataUpdatedAt: integer("metadata_updated_at"),
  observedAt: integer("observed_at").notNull(),
}, (table) => [
  uniqueIndex("pons_v1_launches_pool_unique").on(table.poolAddress),
  uniqueIndex("pons_v1_launches_tx_log_unique").on(table.txHash, table.logIndex),
  index("pons_v1_launches_generation_block_idx").on(table.generation, table.blockNumber),
  index("pons_v1_launches_pair_block_idx").on(table.pairSymbol, table.blockNumber),
  index("pons_v1_launches_deployer_block_idx").on(table.deployerAddress, table.blockNumber),
  index("pons_v1_launches_metadata_idx").on(table.metadataStatus, table.blockNumber),
]);

export const ponsV1Swaps = sqliteTable("pons_v1_swaps", {
  id: text("id").primaryKey(),
  generation: text("generation").notNull(),
  poolAddress: text("pool_address").notNull(),
  tokenAddress: text("token_address").notNull(),
  side: text("side").notNull(),
  senderAddress: text("sender_address").notNull(),
  recipientAddress: text("recipient_address").notNull(),
  amount0Raw: text("amount0_raw").notNull(),
  amount1Raw: text("amount1_raw").notNull(),
  tokenAmountRaw: text("token_amount_raw").notNull(),
  quoteAmountRaw: text("quote_amount_raw").notNull(),
  sqrtPriceX96: text("sqrt_price_x96").notNull(),
  liquidityRaw: text("liquidity_raw").notNull(),
  tick: integer("tick").notNull(),
  blockNumber: integer("block_number").notNull(),
  blockHash: text("block_hash").notNull(),
  blockTimestamp: integer("block_timestamp").notNull(),
  txHash: text("tx_hash").notNull(),
  logIndex: integer("log_index").notNull(),
  observedAt: integer("observed_at").notNull(),
}, (table) => [
  uniqueIndex("pons_v1_swaps_tx_log_unique").on(table.txHash, table.logIndex),
  index("pons_v1_swaps_generation_block_idx").on(table.generation, table.blockNumber),
  index("pons_v1_swaps_token_block_idx").on(table.tokenAddress, table.blockNumber),
  index("pons_v1_swaps_pool_block_idx").on(table.poolAddress, table.blockNumber),
  index("pons_v1_swaps_sender_block_idx").on(table.senderAddress, table.blockNumber),
]);

export const researchPartnerApplications = sqliteTable("research_partner_applications", {
  id: text("id").primaryKey(),
  contact: text("contact").notNull(),
  contactNormalized: text("contact_normalized").notNull(),
  persona: text("persona").notNull(),
  workflow: text("workflow").notNull(),
  sourceView: text("source_view").notNull().default("network"),
  status: text("status").notNull().default("new"),
  createdAt: integer("created_at").notNull().default(sql`(unixepoch())`),
}, (table) => [
  uniqueIndex("research_partner_applications_contact_unique").on(table.contactNormalized),
  index("research_partner_applications_status_time_idx").on(table.status, table.createdAt),
]);

export const memberProfiles = sqliteTable("member_profiles", {
  userId: text("user_id").primaryKey(),
  email: text("email").notNull(),
  displayName: text("display_name").notNull(),
  createdAt: integer("created_at").notNull().default(sql`(unixepoch())`),
  updatedAt: integer("updated_at").notNull().default(sql`(unixepoch())`),
}, (table) => [
  index("member_profiles_email_idx").on(table.email),
]);

export const walletLinkChallenges = sqliteTable("wallet_link_challenges", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull(),
  walletAddress: text("wallet_address").notNull(),
  message: text("message").notNull(),
  expiresAt: integer("expires_at").notNull(),
  usedAt: integer("used_at"),
  createdAt: integer("created_at").notNull().default(sql`(unixepoch())`),
}, (table) => [
  index("wallet_link_challenges_user_time_idx").on(table.userId, table.createdAt),
  index("wallet_link_challenges_expiry_idx").on(table.expiresAt),
]);

export const linkedWallets = sqliteTable("linked_wallets", {
  walletAddress: text("wallet_address").primaryKey(),
  userId: text("user_id").notNull(),
  chainId: integer("chain_id").notNull(),
  isPrimary: integer("is_primary", { mode: "boolean" }).notNull().default(true),
  verifiedAt: integer("verified_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
}, (table) => [
  index("linked_wallets_user_primary_idx").on(table.userId, table.isPrimary),
]);

export const tokenGateChecks = sqliteTable("token_gate_checks", {
  userId: text("user_id").primaryKey(),
  walletAddress: text("wallet_address").notNull(),
  chainId: integer("chain_id").notNull(),
  contractAddress: text("contract_address").notNull(),
  status: text("status").notNull(),
  eligible: integer("eligible", { mode: "boolean" }).notNull().default(false),
  balanceRaw: text("balance_raw"),
  totalSupplyRaw: text("total_supply_raw"),
  thresholdBps: integer("threshold_bps").notNull(),
  blockNumber: integer("block_number"),
  confirmations: integer("confirmations").notNull().default(0),
  providerCount: integer("provider_count").notNull().default(0),
  errorCode: text("error_code"),
  checkedAt: integer("checked_at").notNull(),
  expiresAt: integer("expires_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
}, (table) => [
  index("token_gate_checks_wallet_contract_idx").on(table.walletAddress, table.contractAddress),
  index("token_gate_checks_expiry_idx").on(table.expiresAt),
]);

export const entitlementGrants = sqliteTable("entitlement_grants", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull(),
  source: text("source").notNull(),
  plan: text("plan").notNull(),
  status: text("status").notNull().default("active"),
  allowancesJson: text("allowances_json").notNull().default("{}"),
  reference: text("reference"),
  startsAt: integer("starts_at").notNull(),
  endsAt: integer("ends_at"),
  createdAt: integer("created_at").notNull().default(sql`(unixepoch())`),
}, (table) => [
  index("entitlement_grants_user_status_idx").on(table.userId, table.status),
  index("entitlement_grants_active_window_idx").on(table.startsAt, table.endsAt),
]);

export const entitlementUsage = sqliteTable("entitlement_usage", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull(),
  capability: text("capability").notNull(),
  units: integer("units").notNull(),
  periodKey: text("period_key").notNull(),
  idempotencyKey: text("idempotency_key").notNull(),
  metadataJson: text("metadata_json").notNull().default("{}"),
  observedAt: integer("observed_at").notNull().default(sql`(unixepoch())`),
}, (table) => [
  uniqueIndex("entitlement_usage_idempotency_unique").on(table.idempotencyKey),
  index("entitlement_usage_user_capability_period_idx").on(table.userId, table.capability, table.periodKey),
]);

export const watchtowerWatches = sqliteTable("watchtower_watches", {
  userId: text("user_id").notNull(),
  tokenAddress: text("token_address").notNull(),
  payloadJson: text("payload_json").notNull(),
  createdAt: integer("created_at").notNull().default(sql`(unixepoch())`),
  updatedAt: integer("updated_at").notNull().default(sql`(unixepoch())`),
}, (table) => [
  primaryKey({ columns: [table.userId, table.tokenAddress] }),
  index("watchtower_watches_user_time_idx").on(table.userId, table.updatedAt),
]);
