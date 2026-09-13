CREATE TABLE `pons_aux_jobs` (
	`id` text PRIMARY KEY NOT NULL,
	`locked_until` integer DEFAULT 0 NOT NULL,
	`next_at` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE `pons_token_research` (
	`token_address` text PRIMARY KEY NOT NULL,
	`checked_at` integer NOT NULL,
	`refresh_after` integer NOT NULL,
	`payload_json` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `pons_research_refresh_idx` ON `pons_token_research` (`refresh_after`);