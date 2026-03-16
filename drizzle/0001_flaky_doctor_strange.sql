DROP INDEX `tokens_token_unique`;--> statement-breakpoint
ALTER TABLE `tokens` ADD `source` text DEFAULT 'default' NOT NULL;--> statement-breakpoint
CREATE INDEX `tokens_token_idx` ON `tokens` (`token`);--> statement-breakpoint
CREATE INDEX `tokens_source_idx` ON `tokens` (`source`);