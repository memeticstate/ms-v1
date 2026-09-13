CREATE TABLE `premium_cases` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`token_address` text NOT NULL,
	`title` text NOT NULL,
	`thesis` text NOT NULL,
	`invalidation_note` text NOT NULL,
	`outcome_note` text DEFAULT '' NOT NULL,
	`status` text DEFAULT 'open' NOT NULL,
	`query_json` text NOT NULL,
	`original_evidence_json` text NOT NULL,
	`latest_review_json` text,
	`version` integer DEFAULT 1 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`reviewed_at` integer
);
--> statement-breakpoint
CREATE INDEX `premium_cases_user_updated_idx` ON `premium_cases` (`user_id`,`updated_at`);--> statement-breakpoint
CREATE INDEX `pons_launches_quote_address_block_idx` ON `pons_launches` (`pair_token_address`,`block_number`);--> statement-breakpoint
CREATE INDEX `pons_v1_launches_quote_address_block_idx` ON `pons_v1_launches` (`pair_token_address`,`block_number`);