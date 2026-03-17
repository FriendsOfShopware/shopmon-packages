CREATE TABLE `custom_packages` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`token_id` integer NOT NULL,
	`name` text NOT NULL,
	`version` text NOT NULL,
	`composer_json` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `custom_packages_token_name_version_idx` ON `custom_packages` (`token_id`,`name`,`version`);--> statement-breakpoint
CREATE INDEX `custom_packages_token_id_idx` ON `custom_packages` (`token_id`);
