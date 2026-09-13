CREATE TABLE `research_assignments` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`token_address` text NOT NULL,
	`question` text NOT NULL,
	`focus` text NOT NULL,
	`cadence` text NOT NULL,
	`paused` integer DEFAULT false NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`next_run_at` integer,
	`last_run_at` integer
);
--> statement-breakpoint
CREATE INDEX `research_assignments_owner_idx` ON `research_assignments` (`user_id`,`updated_at`);--> statement-breakpoint
CREATE INDEX `research_assignments_due_idx` ON `research_assignments` (`paused`,`next_run_at`);--> statement-breakpoint
CREATE TABLE `research_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`assignment_id` text NOT NULL,
	`user_id` text NOT NULL,
	`status` text NOT NULL,
	`requested_at` integer NOT NULL,
	`started_at` integer,
	`finished_at` integer,
	`lease_until` integer,
	`lease_token` text,
	`report_json` text,
	`error_code` text,
	FOREIGN KEY (`assignment_id`) REFERENCES `research_assignments`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `research_runs_assignment_idx` ON `research_runs` (`assignment_id`,`requested_at`);--> statement-breakpoint
CREATE INDEX `research_runs_queue_idx` ON `research_runs` (`status`,`requested_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `research_runs_one_active_idx` ON `research_runs` (`assignment_id`) WHERE "research_runs"."status" in ('queued', 'running');