CREATE TABLE IF NOT EXISTS "finance"."stories" (
	"id" serial PRIMARY KEY NOT NULL,
	"ticker" varchar(128) NOT NULL,
	"volume_change" integer NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
