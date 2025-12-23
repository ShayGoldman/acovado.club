CREATE TYPE "acovado"."tracked_subreddit_status" AS ENUM('enabled', 'disabled', 'ignored');--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "acovado"."tracked_subreddits" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" varchar(128) NOT NULL,
	"status" "acovado"."tracked_subreddit_status" DEFAULT 'disabled' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "tracked_subreddits_name_unique" UNIQUE("name")
);
