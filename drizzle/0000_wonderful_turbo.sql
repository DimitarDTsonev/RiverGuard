CREATE TABLE `measurement_annotations` (
	`id` text PRIMARY KEY NOT NULL,
	`reading_id` text NOT NULL,
	`station_id` text NOT NULL,
	`quality` text NOT NULL,
	`reason` text NOT NULL,
	`actor_id` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `annotations_reading` ON `measurement_annotations` (`reading_id`);--> statement-breakpoint
CREATE TABLE `audit_log` (
	`id` text PRIMARY KEY NOT NULL,
	`actor_id` text NOT NULL,
	`actor` text NOT NULL,
	`role` text NOT NULL,
	`action` text NOT NULL,
	`entity` text NOT NULL,
	`details` text NOT NULL,
	`municipality` text,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `audit_created` ON `audit_log` (`created_at`);--> statement-breakpoint
CREATE INDEX `audit_scope` ON `audit_log` (`municipality`);--> statement-breakpoint
CREATE TABLE `training_completions` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`training_id` text NOT NULL,
	`completed_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `memberships` (
	`user_id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`role` text NOT NULL,
	`municipality` text,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `raw_measurements` (
	`id` text PRIMARY KEY NOT NULL,
	`station_id` text NOT NULL,
	`measured_at` text NOT NULL,
	`data` text NOT NULL,
	`received_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `readings_station_time` ON `raw_measurements` (`station_id`,`measured_at`);--> statement-breakpoint
CREATE TABLE `records` (
	`key` text PRIMARY KEY NOT NULL,
	`kind` text NOT NULL,
	`record_id` text NOT NULL,
	`municipality` text,
	`station_id` text,
	`data` text NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `records_kind` ON `records` (`kind`);--> statement-breakpoint
CREATE INDEX `records_scope` ON `records` (`municipality`);--> statement-breakpoint
CREATE TABLE `demo_sessions` (
	`user_id` text PRIMARY KEY NOT NULL,
	`role` text NOT NULL,
	`municipality` text,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `app_settings` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL
);
