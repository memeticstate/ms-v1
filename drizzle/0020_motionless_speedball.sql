CREATE TABLE `pons_token_state_history` (
	`id` text PRIMARY KEY NOT NULL,
	`token_address` text NOT NULL,
	`observed_at` integer NOT NULL,
	`indexed_block` integer NOT NULL,
	`phase` text NOT NULL,
	`signal` text NOT NULL,
	`eligible` integer NOT NULL,
	`evidence_status` text NOT NULL,
	`holder_sample_size` integer,
	`meaningful_holders` integer,
	`holder_qualified` integer NOT NULL,
	`recent_trades` integer NOT NULL,
	`previous_trades` integer NOT NULL,
	`recent_actors` integer NOT NULL,
	`previous_actors` integer NOT NULL,
	`change_kind` text NOT NULL,
	`payload_json` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `pons_token_state_history_token_time_idx` ON `pons_token_state_history` (`token_address`,`observed_at`);--> statement-breakpoint
CREATE INDEX `pons_token_state_history_observed_idx` ON `pons_token_state_history` (`observed_at`);--> statement-breakpoint
CREATE INDEX `pons_token_state_history_signal_idx` ON `pons_token_state_history` (`signal`,`observed_at`);