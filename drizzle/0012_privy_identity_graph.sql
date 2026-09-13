CREATE TABLE `member_identities` (
	`provider` text NOT NULL,
	`subject` text NOT NULL,
	`user_id` text NOT NULL,
	`last_authenticated_at` integer NOT NULL,
	`last_synced_at` integer NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	PRIMARY KEY(`provider`, `subject`)
);
--> statement-breakpoint
CREATE INDEX `member_identities_user_idx` ON `member_identities` (`user_id`);--> statement-breakpoint
CREATE INDEX `member_identities_last_auth_idx` ON `member_identities` (`last_authenticated_at`);--> statement-breakpoint
ALTER TABLE `linked_wallets` ADD `source` text DEFAULT 'signature' NOT NULL;
