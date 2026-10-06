-- Adds the handed_off and abandoned run outcomes (issue #147). SQLite can't
-- change a CHECK constraint in place, so drizzle-kit rebuilds the table.
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_tool_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`tool_id` text NOT NULL,
	`status` text NOT NULL,
	`started_at` text NOT NULL,
	`duration_ms` integer,
	`input_bytes` integer,
	`output_bytes` integer,
	`error_code` text,
	`metadata` text,
	CONSTRAINT "tool_runs_status_check" CHECK("__new_tool_runs"."status" IN ('started', 'succeeded', 'failed', 'handed_off', 'abandoned')),
	CONSTRAINT "tool_runs_metadata_check" CHECK("__new_tool_runs"."metadata" IS NULL OR json_valid("__new_tool_runs"."metadata"))
);
--> statement-breakpoint
INSERT INTO `__new_tool_runs`("id", "tool_id", "status", "started_at", "duration_ms", "input_bytes", "output_bytes", "error_code", "metadata") SELECT "id", "tool_id", "status", "started_at", "duration_ms", "input_bytes", "output_bytes", "error_code", "metadata" FROM `tool_runs`;--> statement-breakpoint
DROP TABLE `tool_runs`;--> statement-breakpoint
ALTER TABLE `__new_tool_runs` RENAME TO `tool_runs`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `idx_tool_runs_tool_id_started_at` ON `tool_runs` (`tool_id`,`started_at`);--> statement-breakpoint
CREATE INDEX `idx_tool_runs_status_started_at` ON `tool_runs` (`status`,`started_at`);--> statement-breakpoint
-- Downloader runs that only showed the extension prompt were recorded as
-- failures; they are hand-offs.
UPDATE `tool_runs` SET `status` = 'handed_off' WHERE `status` = 'failed' AND `error_code` IN ('known_unreliable_web_downloader', 'downloader_extension_only');
