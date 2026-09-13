CREATE TABLE `premium_supply_references` (
	`chain_id` integer NOT NULL,
	`contract_address` text NOT NULL,
	`supply_raw` text NOT NULL,
	`decimals` integer NOT NULL,
	`block_number` integer NOT NULL,
	`recorded_at` integer NOT NULL,
	PRIMARY KEY(`chain_id`, `contract_address`)
);
