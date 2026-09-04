CREATE TABLE `entitlement_grants` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`source` text NOT NULL,
	`plan` text NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`allowances_json` text DEFAULT '{}' NOT NULL,
	`reference` text,
	`starts_at` integer NOT NULL,
	`ends_at` integer,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `entitlement_grants_user_status_idx` ON `entitlement_grants` (`user_id`,`status`);--> statement-breakpoint
CREATE INDEX `entitlement_grants_active_window_idx` ON `entitlement_grants` (`starts_at`,`ends_at`);--> statement-breakpoint
CREATE TABLE `entitlement_usage` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`capability` text NOT NULL,
	`units` integer NOT NULL,
	`period_key` text NOT NULL,
	`idempotency_key` text NOT NULL,
	`metadata_json` text DEFAULT '{}' NOT NULL,
	`observed_at` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `entitlement_usage_idempotency_unique` ON `entitlement_usage` (`idempotency_key`);--> statement-breakpoint
CREATE INDEX `entitlement_usage_user_capability_period_idx` ON `entitlement_usage` (`user_id`,`capability`,`period_key`);--> statement-breakpoint
CREATE TABLE `linked_wallets` (
	`wallet_address` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`chain_id` integer NOT NULL,
	`is_primary` integer DEFAULT true NOT NULL,
	`verified_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `linked_wallets_user_primary_idx` ON `linked_wallets` (`user_id`,`is_primary`);--> statement-breakpoint
CREATE TABLE `member_profiles` (
	`user_id` text PRIMARY KEY NOT NULL,
	`email` text NOT NULL,
	`display_name` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `member_profiles_email_idx` ON `member_profiles` (`email`);--> statement-breakpoint
CREATE TABLE `wallet_link_challenges` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`wallet_address` text NOT NULL,
	`message` text NOT NULL,
	`expires_at` integer NOT NULL,
	`used_at` integer,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `wallet_link_challenges_user_time_idx` ON `wallet_link_challenges` (`user_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `wallet_link_challenges_expiry_idx` ON `wallet_link_challenges` (`expires_at`);--> statement-breakpoint
CREATE TABLE `watchtower_watches` (
	`user_id` text NOT NULL,
	`token_address` text NOT NULL,
	`payload_json` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	PRIMARY KEY(`user_id`, `token_address`)
);
--> statement-breakpoint
CREATE INDEX `watchtower_watches_user_time_idx` ON `watchtower_watches` (`user_id`,`updated_at`);