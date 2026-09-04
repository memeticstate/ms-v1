CREATE TABLE `affinity_edge_observations` (
	`snapshot_id` text NOT NULL,
	`species_id` text NOT NULL,
	`habitat` text NOT NULL,
	`observed_at` integer NOT NULL,
	`protocol` text NOT NULL,
	`declared_weight` real,
	`strength` real NOT NULL,
	PRIMARY KEY(`snapshot_id`, `species_id`, `habitat`),
	FOREIGN KEY (`snapshot_id`) REFERENCES `affinity_snapshots`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `affinity_edges_species_time_idx` ON `affinity_edge_observations` (`species_id`,`observed_at`);--> statement-breakpoint
CREATE INDEX `affinity_edges_habitat_time_idx` ON `affinity_edge_observations` (`habitat`,`observed_at`);--> statement-breakpoint
CREATE TABLE `species_observations` (
	`snapshot_id` text NOT NULL,
	`species_id` text NOT NULL,
	`observed_at` integer NOT NULL,
	`protocol` text NOT NULL,
	`contract_address` text NOT NULL,
	`symbol` text NOT NULL,
	`market_cap_usd` real NOT NULL,
	`volume_24h_usd` real NOT NULL,
	`liquidity_usd` real NOT NULL,
	`total_depth_usd` real NOT NULL,
	`trades_24h` integer,
	`change_24h` real NOT NULL,
	`affinity_balance` integer NOT NULL,
	`market_vitality` integer NOT NULL,
	`market_stress` integer NOT NULL,
	`turnover_24h` real NOT NULL,
	`depth_ratio` real NOT NULL,
	PRIMARY KEY(`snapshot_id`, `species_id`),
	FOREIGN KEY (`snapshot_id`) REFERENCES `affinity_snapshots`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `species_observations_species_time_idx` ON `species_observations` (`species_id`,`observed_at`);--> statement-breakpoint
CREATE INDEX `species_observations_contract_time_idx` ON `species_observations` (`contract_address`,`observed_at`);