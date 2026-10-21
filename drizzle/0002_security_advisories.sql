CREATE TABLE `security_advisories` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`package_name` text NOT NULL,
	`advisory_id` text NOT NULL,
	`affected_versions` text NOT NULL,
	`title` text NOT NULL,
	`reported_at` text NOT NULL,
	`sources` text NOT NULL,
	`cve` text,
	`link` text,
	`severity` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `security_advisories_package_advisory_idx` ON `security_advisories` (`package_name`,`advisory_id`);