CREATE TABLE IF NOT EXISTS "finance"."stories" (
	"id" serial PRIMARY KEY NOT NULL,
	"ticker_id" varchar(128) NOT NULL,
	"signal_id" integer NOT NULL,
	"change" double precision NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
