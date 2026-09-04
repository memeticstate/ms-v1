CREATE TABLE `chain_blocks` (
	`id` text PRIMARY KEY NOT NULL,
	`number` integer NOT NULL,
	`detected_at` integer NOT NULL,
	`snapshot_id` text NOT NULL,
	`previous_snapshot_id` text,
	`kind` text NOT NULL,
	`significance` integer NOT NULL,
	`payload_json` text NOT NULL,
	`provenance_json` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`snapshot_id`) REFERENCES `affinity_snapshots`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`previous_snapshot_id`) REFERENCES `affinity_snapshots`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `chain_blocks_number_unique` ON `chain_blocks` (`number`);--> statement-breakpoint
CREATE INDEX `chain_blocks_detected_at_idx` ON `chain_blocks` (`detected_at`);--> statement-breakpoint
CREATE INDEX `chain_blocks_snapshot_idx` ON `chain_blocks` (`snapshot_id`);