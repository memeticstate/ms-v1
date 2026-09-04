CREATE TABLE `rpc_provider_observations` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`observed_at` integer NOT NULL,
	`provider` text NOT NULL,
	`status` text NOT NULL,
	`latency_ms` integer NOT NULL,
	`block_number` integer,
	`block_hash` text,
	`error_code` text
);
--> statement-breakpoint
CREATE INDEX `rpc_provider_observations_provider_time_idx` ON `rpc_provider_observations` (`provider`,`observed_at`);--> statement-breakpoint
CREATE INDEX `rpc_provider_observations_status_time_idx` ON `rpc_provider_observations` (`status`,`observed_at`);