CREATE TABLE `collection_state` (
	`id` text PRIMARY KEY NOT NULL,
	`locked_until` integer DEFAULT 0 NOT NULL,
	`last_attempt_at` integer,
	`last_success_at` integer,
	`last_failure_at` integer,
	`last_snapshot_id` text,
	`last_error_code` text,
	`consecutive_failures` integer DEFAULT 0 NOT NULL
);
