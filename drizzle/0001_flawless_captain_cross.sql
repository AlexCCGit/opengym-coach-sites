CREATE TABLE `app_setting` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `profile_activity` (
	`user_id` text PRIMARY KEY NOT NULL,
	`status` text NOT NULL,
	`routine_name` text,
	`started_at` text,
	`last_seen_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `profile_control` (
	`user_id` text PRIMARY KEY NOT NULL,
	`disabled` integer DEFAULT 0 NOT NULL,
	`invited` integer DEFAULT 0 NOT NULL,
	`updated_at` text NOT NULL
);
