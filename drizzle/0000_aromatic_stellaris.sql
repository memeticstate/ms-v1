CREATE TABLE `affinity_snapshots` (
	`id` text PRIMARY KEY NOT NULL,
	`observed_at` integer NOT NULL,
	`generated_at` integer NOT NULL,
	`chain_id` integer NOT NULL,
	`block_number` integer NOT NULL,
	`block_hash` text NOT NULL,
	`reconciliation_status` text NOT NULL,
	`payload_json` text NOT NULL,
	`provenance_json` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `affinity_snapshots_observed_at_idx` ON `affinity_snapshots` (`observed_at`);--> statement-breakpoint
CREATE INDEX `affinity_snapshots_block_number_idx` ON `affinity_snapshots` (`block_number`);--> statement-breakpoint
CREATE TABLE `reconciliation_records` (
	`snapshot_id` text NOT NULL,
	`species_id` text NOT NULL,
	`contract_address` text NOT NULL,
	`launch_tx_hash` text NOT NULL,
	`launch_block_number` integer NOT NULL,
	`code_verified` integer NOT NULL,
	`launch_verified` integer NOT NULL,
	PRIMARY KEY(`snapshot_id`, `species_id`),
	FOREIGN KEY (`snapshot_id`) REFERENCES `affinity_snapshots`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `reconciliation_records_contract_idx` ON `reconciliation_records` (`contract_address`);