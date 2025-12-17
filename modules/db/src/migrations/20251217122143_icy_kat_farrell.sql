CREATE TABLE IF NOT EXISTS "acovado"."reddit_threads" (
	"id" serial PRIMARY KEY NOT NULL,
	"reddit_id" varchar(64) NOT NULL,
	"subreddit" varchar(128) NOT NULL,
	"title" varchar(512) NOT NULL,
	"author" varchar(128) NOT NULL,
	"selftext" text NOT NULL,
	"url" varchar(512) NOT NULL,
	"permalink" varchar(512) NOT NULL,
	"score" integer NOT NULL,
	"num_comments" integer NOT NULL,
	"created_utc" timestamp NOT NULL,
	"status" varchar(32) NOT NULL,
	"data" jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "reddit_threads_reddit_id_unique" UNIQUE("reddit_id")
);
