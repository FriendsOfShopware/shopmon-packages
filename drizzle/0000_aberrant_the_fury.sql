CREATE TABLE `packages` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`version` text NOT NULL,
	`composer_json` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `packages_name_version_idx` ON `packages` (`name`,`version`);--> statement-breakpoint
CREATE TABLE `tokens` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`token` text NOT NULL,
	`packages` text DEFAULT '{}' NOT NULL,
	`last_synced_at` integer
);
--> statement-breakpoint
CREATE UNIQUE INDEX `tokens_token_unique` ON `tokens` (`token`);