CREATE TABLE `pons_generation_index_state` (
	`id` text PRIMARY KEY NOT NULL,
	`factory_address` text NOT NULL,
	`start_block` integer NOT NULL,
	`launch_next_block` integer NOT NULL,
	`swap_next_block` integer NOT NULL,
	`latest_seen_block` integer DEFAULT 0 NOT NULL,
	`locked_until` integer DEFAULT 0 NOT NULL,
	`last_attempt_at` integer,
	`last_success_at` integer,
	`last_failure_at` integer,
	`last_error_code` text,
	`consecutive_failures` integer DEFAULT 0 NOT NULL,
	`last_record_count` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE INDEX `pons_generation_index_progress_idx` ON `pons_generation_index_state` (`launch_next_block`,`swap_next_block`);--> statement-breakpoint
CREATE INDEX `pons_generation_index_success_idx` ON `pons_generation_index_state` (`last_success_at`);--> statement-breakpoint
CREATE TABLE `pons_v1_launches` (
	`token_address` text PRIMARY KEY NOT NULL,
	`generation` text NOT NULL,
	`factory_address` text NOT NULL,
	`deployer_address` text NOT NULL,
	`dex_factory_address` text NOT NULL,
	`pair_token_address` text NOT NULL,
	`pair_symbol` text NOT NULL,
	`pool_address` text NOT NULL,
	`dex_id` text NOT NULL,
	`launch_config_id` text NOT NULL,
	`position_id` text NOT NULL,
	`restrictions_end_block` text NOT NULL,
	`initial_buy_amount_raw` text NOT NULL,
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
CREATE UNIQUE INDEX `pons_v1_launches_pool_unique` ON `pons_v1_launches` (`pool_address`);--> statement-breakpoint
CREATE UNIQUE INDEX `pons_v1_launches_tx_log_unique` ON `pons_v1_launches` (`tx_hash`,`log_index`);--> statement-breakpoint
CREATE INDEX `pons_v1_launches_generation_block_idx` ON `pons_v1_launches` (`generation`,`block_number`);--> statement-breakpoint
CREATE INDEX `pons_v1_launches_pair_block_idx` ON `pons_v1_launches` (`pair_symbol`,`block_number`);--> statement-breakpoint
CREATE INDEX `pons_v1_launches_deployer_block_idx` ON `pons_v1_launches` (`deployer_address`,`block_number`);--> statement-breakpoint
CREATE INDEX `pons_v1_launches_metadata_idx` ON `pons_v1_launches` (`metadata_status`,`block_number`);--> statement-breakpoint
CREATE TABLE `pons_v1_swaps` (
	`id` text PRIMARY KEY NOT NULL,
	`generation` text NOT NULL,
	`pool_address` text NOT NULL,
	`token_address` text NOT NULL,
	`side` text NOT NULL,
	`sender_address` text NOT NULL,
	`recipient_address` text NOT NULL,
	`amount0_raw` text NOT NULL,
	`amount1_raw` text NOT NULL,
	`token_amount_raw` text NOT NULL,
	`quote_amount_raw` text NOT NULL,
	`sqrt_price_x96` text NOT NULL,
	`liquidity_raw` text NOT NULL,
	`tick` integer NOT NULL,
	`block_number` integer NOT NULL,
	`block_hash` text NOT NULL,
	`block_timestamp` integer NOT NULL,
	`tx_hash` text NOT NULL,
	`log_index` integer NOT NULL,
	`observed_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `pons_v1_swaps_tx_log_unique` ON `pons_v1_swaps` (`tx_hash`,`log_index`);--> statement-breakpoint
CREATE INDEX `pons_v1_swaps_generation_block_idx` ON `pons_v1_swaps` (`generation`,`block_number`);--> statement-breakpoint
CREATE INDEX `pons_v1_swaps_token_block_idx` ON `pons_v1_swaps` (`token_address`,`block_number`);--> statement-breakpoint
CREATE INDEX `pons_v1_swaps_pool_block_idx` ON `pons_v1_swaps` (`pool_address`,`block_number`);--> statement-breakpoint
CREATE INDEX `pons_v1_swaps_sender_block_idx` ON `pons_v1_swaps` (`sender_address`,`block_number`);