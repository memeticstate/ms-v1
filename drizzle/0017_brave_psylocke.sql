CREATE TABLE `pons_recent_curve_checks` (
	`token_address` text PRIMARY KEY NOT NULL,
	`locked_until` integer DEFAULT 0 NOT NULL,
	`retry_after` integer DEFAULT 0 NOT NULL,
	`payload_json` text,
	`last_error` text
);
