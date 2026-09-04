CREATE TABLE `pons_activity_snapshots` (
	`id` text PRIMARY KEY NOT NULL,
	`observed_at` integer NOT NULL,
	`from_block` integer NOT NULL,
	`to_block` integer NOT NULL,
	`head_block` integer NOT NULL,
	`launch_count` integer DEFAULT 0 NOT NULL,
	`graduation_count` integer DEFAULT 0 NOT NULL,
	`buy_count` integer DEFAULT 0 NOT NULL,
	`sell_count` integer DEFAULT 0 NOT NULL,
	`active_deployers` integer DEFAULT 0 NOT NULL,
	`active_traders` integer DEFAULT 0 NOT NULL,
	`payload_json` text DEFAULT '{}' NOT NULL
);
--> statement-breakpoint
CREATE INDEX `pons_activity_snapshots_observed_idx` ON `pons_activity_snapshots` (`observed_at`);--> statement-breakpoint
CREATE INDEX `pons_activity_snapshots_block_idx` ON `pons_activity_snapshots` (`to_block`);--> statement-breakpoint
CREATE TABLE `pons_curve_trades` (
	`id` text PRIMARY KEY NOT NULL,
	`curve_address` text NOT NULL,
	`token_address` text NOT NULL,
	`side` text NOT NULL,
	`actor_address` text NOT NULL,
	`recipient_address` text NOT NULL,
	`quote_amount_raw` text NOT NULL,
	`token_amount_raw` text NOT NULL,
	`fee_raw` text NOT NULL,
	`tax_raw` text NOT NULL,
	`block_number` integer NOT NULL,
	`block_hash` text NOT NULL,
	`block_timestamp` integer NOT NULL,
	`tx_hash` text NOT NULL,
	`log_index` integer NOT NULL,
	`observed_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `pons_curve_trades_tx_log_unique` ON `pons_curve_trades` (`tx_hash`,`log_index`);--> statement-breakpoint
CREATE INDEX `pons_curve_trades_token_block_idx` ON `pons_curve_trades` (`token_address`,`block_number`);--> statement-breakpoint
CREATE INDEX `pons_curve_trades_curve_block_idx` ON `pons_curve_trades` (`curve_address`,`block_number`);--> statement-breakpoint
CREATE INDEX `pons_curve_trades_actor_block_idx` ON `pons_curve_trades` (`actor_address`,`block_number`);--> statement-breakpoint
CREATE INDEX `pons_curve_trades_block_idx` ON `pons_curve_trades` (`block_number`);--> statement-breakpoint
CREATE TABLE `pons_events` (
	`id` text PRIMARY KEY NOT NULL,
	`event_type` text NOT NULL,
	`token_address` text NOT NULL,
	`emitter_address` text NOT NULL,
	`block_number` integer NOT NULL,
	`block_hash` text NOT NULL,
	`block_timestamp` integer NOT NULL,
	`tx_hash` text NOT NULL,
	`log_index` integer NOT NULL,
	`data_json` text DEFAULT '{}' NOT NULL,
	`observed_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `pons_events_tx_log_unique` ON `pons_events` (`tx_hash`,`log_index`);--> statement-breakpoint
CREATE INDEX `pons_events_type_block_idx` ON `pons_events` (`event_type`,`block_number`);--> statement-breakpoint
CREATE INDEX `pons_events_token_block_idx` ON `pons_events` (`token_address`,`block_number`);--> statement-breakpoint
CREATE INDEX `pons_events_block_idx` ON `pons_events` (`block_number`);--> statement-breakpoint
CREATE TABLE `pons_index_state` (
	`id` text PRIMARY KEY NOT NULL,
	`locked_until` integer DEFAULT 0 NOT NULL,
	`initialized_at` integer,
	`live_next_block` integer DEFAULT 0 NOT NULL,
	`backfill_next_block` integer DEFAULT 0 NOT NULL,
	`latest_safe_block` integer DEFAULT 0 NOT NULL,
	`latest_safe_hash` text,
	`latest_seen_block` integer DEFAULT 0 NOT NULL,
	`last_attempt_at` integer,
	`last_success_at` integer,
	`last_failure_at` integer,
	`last_error_code` text,
	`consecutive_failures` integer DEFAULT 0 NOT NULL,
	`last_record_count` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE `pons_launches` (
	`token_address` text PRIMARY KEY NOT NULL,
	`curve_address` text NOT NULL,
	`deployer_address` text NOT NULL,
	`pair_token_address` text NOT NULL,
	`pair_symbol` text NOT NULL,
	`pair_decimals` integer NOT NULL,
	`launch_config_id` integer NOT NULL,
	`graduation_threshold_raw` text NOT NULL,
	`block_number` integer NOT NULL,
	`block_hash` text NOT NULL,
	`block_timestamp` integer NOT NULL,
	`tx_hash` text NOT NULL,
	`log_index` integer NOT NULL,
	`token_name` text,
	`token_symbol` text,
	`metadata_status` text DEFAULT 'pending' NOT NULL,
	`metadata_updated_at` integer,
	`observed_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `pons_launches_curve_unique` ON `pons_launches` (`curve_address`);--> statement-breakpoint
CREATE UNIQUE INDEX `pons_launches_tx_log_unique` ON `pons_launches` (`tx_hash`,`log_index`);--> statement-breakpoint
CREATE INDEX `pons_launches_pair_block_idx` ON `pons_launches` (`pair_symbol`,`block_number`);--> statement-breakpoint
CREATE INDEX `pons_launches_deployer_block_idx` ON `pons_launches` (`deployer_address`,`block_number`);--> statement-breakpoint
CREATE INDEX `pons_launches_block_idx` ON `pons_launches` (`block_number`);--> statement-breakpoint
CREATE INDEX `pons_launches_metadata_idx` ON `pons_launches` (`metadata_status`,`block_number`);