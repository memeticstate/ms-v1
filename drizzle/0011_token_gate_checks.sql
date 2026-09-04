CREATE TABLE `token_gate_checks` (
	`user_id` text PRIMARY KEY NOT NULL,
	`wallet_address` text NOT NULL,
	`chain_id` integer NOT NULL,
	`contract_address` text NOT NULL,
	`status` text NOT NULL,
	`eligible` integer DEFAULT false NOT NULL,
	`balance_raw` text,
	`total_supply_raw` text,
	`threshold_bps` integer NOT NULL,
	`block_number` integer,
	`confirmations` integer DEFAULT 0 NOT NULL,
	`provider_count` integer DEFAULT 0 NOT NULL,
	`error_code` text,
	`checked_at` integer NOT NULL,
	`expires_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `token_gate_checks_wallet_contract_idx` ON `token_gate_checks` (`wallet_address`,`contract_address`);
--> statement-breakpoint
CREATE INDEX `token_gate_checks_expiry_idx` ON `token_gate_checks` (`expires_at`);
