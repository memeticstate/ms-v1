CREATE TABLE `cohort_members` (
	`contract_address` text PRIMARY KEY NOT NULL,
	`species_id` text NOT NULL,
	`symbol` text NOT NULL,
	`selected` integer DEFAULT false NOT NULL,
	`eligible_streak` integer DEFAULT 0 NOT NULL,
	`miss_streak` integer DEFAULT 0 NOT NULL,
	`last_rank` integer,
	`selection_score` real DEFAULT 0 NOT NULL,
	`first_seen_at` integer NOT NULL,
	`last_seen_at` integer NOT NULL,
	`selected_since` integer,
	`metadata_json` text DEFAULT '{}' NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `cohort_members_species_unique` ON `cohort_members` (`species_id`);--> statement-breakpoint
CREATE INDEX `cohort_members_selected_rank_idx` ON `cohort_members` (`selected`,`last_rank`);--> statement-breakpoint
CREATE INDEX `cohort_members_last_seen_idx` ON `cohort_members` (`last_seen_at`);--> statement-breakpoint
CREATE TABLE `collection_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`trigger` text NOT NULL,
	`lane` text NOT NULL,
	`status` text NOT NULL,
	`phase` text NOT NULL,
	`started_at` integer NOT NULL,
	`completed_at` integer,
	`duration_ms` integer,
	`snapshot_id` text,
	`discovered_species` integer DEFAULT 0 NOT NULL,
	`observed_species` integer DEFAULT 0 NOT NULL,
	`verified_species` integer DEFAULT 0 NOT NULL,
	`warning_count` integer DEFAULT 0 NOT NULL,
	`error_code` text,
	`metadata_json` text DEFAULT '{}' NOT NULL,
	FOREIGN KEY (`snapshot_id`) REFERENCES `affinity_snapshots`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `collection_runs_started_at_idx` ON `collection_runs` (`started_at`);--> statement-breakpoint
CREATE INDEX `collection_runs_status_time_idx` ON `collection_runs` (`status`,`started_at`);--> statement-breakpoint
CREATE TABLE `contract_attestations` (
	`contract_address` text PRIMARY KEY NOT NULL,
	`species_id` text NOT NULL,
	`launch_tx_hash` text NOT NULL,
	`launch_block_number` integer NOT NULL,
	`code_hash` text NOT NULL,
	`code_verified` integer NOT NULL,
	`launch_verified` integer NOT NULL,
	`provider_quorum` integer NOT NULL,
	`first_verified_at` integer NOT NULL,
	`last_verified_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `contract_attestations_species_idx` ON `contract_attestations` (`species_id`);--> statement-breakpoint
CREATE INDEX `contract_attestations_verified_at_idx` ON `contract_attestations` (`last_verified_at`);--> statement-breakpoint
CREATE TABLE `engine_alerts` (
	`id` text PRIMARY KEY NOT NULL,
	`detected_at` integer NOT NULL,
	`severity` text NOT NULL,
	`code` text NOT NULL,
	`entity_type` text NOT NULL,
	`entity_id` text NOT NULL,
	`message` text NOT NULL,
	`evidence_json` text DEFAULT '{}' NOT NULL,
	`snapshot_id` text,
	`resolved_at` integer,
	FOREIGN KEY (`snapshot_id`) REFERENCES `affinity_snapshots`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `engine_alerts_detected_at_idx` ON `engine_alerts` (`detected_at`);--> statement-breakpoint
CREATE INDEX `engine_alerts_open_severity_idx` ON `engine_alerts` (`resolved_at`,`severity`);--> statement-breakpoint
CREATE INDEX `engine_alerts_entity_idx` ON `engine_alerts` (`entity_type`,`entity_id`);--> statement-breakpoint
CREATE TABLE `robinhood_assets` (
	`asset_uid` text PRIMARY KEY NOT NULL,
	`token_symbol` text NOT NULL,
	`token_name` text NOT NULL,
	`status` text NOT NULL,
	`contract_address` text NOT NULL,
	`chain_id` integer NOT NULL,
	`current_multiplier` text,
	`pending_multiplier` text,
	`pending_effective_at` integer,
	`logo_url` text,
	`isin` text,
	`token_decimals` integer,
	`trading_capabilities_json` text DEFAULT '{}' NOT NULL,
	`content_hash` text NOT NULL,
	`observed_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `robinhood_assets_symbol_unique` ON `robinhood_assets` (`token_symbol`);--> statement-breakpoint
CREATE UNIQUE INDEX `robinhood_assets_contract_unique` ON `robinhood_assets` (`contract_address`);--> statement-breakpoint
CREATE INDEX `robinhood_assets_status_idx` ON `robinhood_assets` (`status`);--> statement-breakpoint
CREATE TABLE `robinhood_corporate_actions` (
	`id` text PRIMARY KEY NOT NULL,
	`token_symbol` text,
	`action_type` text NOT NULL,
	`status` text,
	`process_date` text,
	`first_seen_at` integer NOT NULL,
	`last_seen_at` integer NOT NULL,
	`details_json` text NOT NULL,
	`content_hash` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `robinhood_corporate_actions_symbol_idx` ON `robinhood_corporate_actions` (`token_symbol`);--> statement-breakpoint
CREATE INDEX `robinhood_corporate_actions_seen_idx` ON `robinhood_corporate_actions` (`last_seen_at`);--> statement-breakpoint
CREATE TABLE `robinhood_quotes` (
	`symbol` text NOT NULL,
	`observed_at` integer NOT NULL,
	`generated_at` integer NOT NULL,
	`bid` real NOT NULL,
	`ask` real NOT NULL,
	`mid` real NOT NULL,
	`spread_bps` real NOT NULL,
	`daily_volume` real,
	`halted` integer DEFAULT false NOT NULL,
	`multiplier` text,
	`token_bid` real,
	`token_ask` real,
	`freshness_ms` integer NOT NULL,
	PRIMARY KEY(`symbol`, `observed_at`)
);
--> statement-breakpoint
CREATE INDEX `robinhood_quotes_symbol_time_idx` ON `robinhood_quotes` (`symbol`,`observed_at`);--> statement-breakpoint
CREATE INDEX `robinhood_quotes_generated_at_idx` ON `robinhood_quotes` (`generated_at`);--> statement-breakpoint
CREATE TABLE `source_observations` (
	`run_id` text NOT NULL,
	`source` text NOT NULL,
	`status` text NOT NULL,
	`started_at` integer NOT NULL,
	`completed_at` integer NOT NULL,
	`latency_ms` integer NOT NULL,
	`freshness_ms` integer,
	`record_count` integer DEFAULT 0 NOT NULL,
	`error_code` text,
	`metadata_json` text DEFAULT '{}' NOT NULL,
	PRIMARY KEY(`run_id`, `source`),
	FOREIGN KEY (`run_id`) REFERENCES `collection_runs`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `source_observations_source_time_idx` ON `source_observations` (`source`,`completed_at`);--> statement-breakpoint
CREATE INDEX `source_observations_status_time_idx` ON `source_observations` (`status`,`completed_at`);