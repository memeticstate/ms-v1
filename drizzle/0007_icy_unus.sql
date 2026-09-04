CREATE TABLE `research_partner_applications` (
	`id` text PRIMARY KEY NOT NULL,
	`contact` text NOT NULL,
	`contact_normalized` text NOT NULL,
	`persona` text NOT NULL,
	`workflow` text NOT NULL,
	`source_view` text DEFAULT 'network' NOT NULL,
	`status` text DEFAULT 'new' NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `research_partner_applications_contact_unique` ON `research_partner_applications` (`contact_normalized`);--> statement-breakpoint
CREATE INDEX `research_partner_applications_status_time_idx` ON `research_partner_applications` (`status`,`created_at`);