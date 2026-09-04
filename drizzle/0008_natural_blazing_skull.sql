CREATE TABLE `pons_state_cache` (
	`window_blocks` integer PRIMARY KEY NOT NULL,
	`generated_at` integer NOT NULL,
	`indexed_block` integer NOT NULL,
	`payload_json` text NOT NULL
);
