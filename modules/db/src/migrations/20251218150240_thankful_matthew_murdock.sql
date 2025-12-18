CREATE TABLE IF NOT EXISTS "acovado"."reddit_replies" (
	"id" serial PRIMARY KEY NOT NULL,
	"reddit_id" varchar(64) NOT NULL,
	"thread_id" integer NOT NULL,
	"parent_reddit_id" varchar(64),
	"author" varchar(128) NOT NULL,
	"body" text NOT NULL,
	"score" integer NOT NULL,
	"created_utc" timestamp NOT NULL,
	"status" varchar(32) NOT NULL,
	"data" jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "reddit_replies_reddit_id_unique" UNIQUE("reddit_id")
);
--> statement-breakpoint
ALTER TABLE "acovado"."reddit_threads" ADD COLUMN "last_reply_fetch_at" timestamp;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "acovado"."reddit_replies" ADD CONSTRAINT "reddit_replies_thread_id_reddit_threads_id_fk" FOREIGN KEY ("thread_id") REFERENCES "acovado"."reddit_threads"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
