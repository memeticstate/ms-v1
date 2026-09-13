CREATE TABLE `token_discovery_cache` (
	`key` text PRIMARY KEY NOT NULL,
	`payload_json` text NOT NULL,
	`fetched_at` integer NOT NULL,
	`expires_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `token_discovery_cache_expiry_idx` ON `token_discovery_cache` (`expires_at`);