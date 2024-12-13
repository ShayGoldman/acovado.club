CREATE SCHEMA "finance";
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "finance"."collections" (
	"id" serial PRIMARY KEY NOT NULL,
	"status" varchar(64) NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "finance"."signal_metrics" (
	"id" serial PRIMARY KEY NOT NULL,
	"ticker_id" uuid NOT NULL,
	"collection_id" integer NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "finance"."tickers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(64) NOT NULL,
	"symbol" varchar(8) NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "tickers_symbol_unique" UNIQUE("symbol")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "finance"."watch_list_to_tickers" (
	"watch_list_id" uuid NOT NULL,
	"ticker_id" uuid NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "watch_list_to_tickers_watch_list_id_ticker_id_pk" PRIMARY KEY("watch_list_id","ticker_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "finance"."watch_lists" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(128) NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "finance"."signal_metrics" ADD CONSTRAINT "signal_metrics_ticker_id_tickers_id_fk" FOREIGN KEY ("ticker_id") REFERENCES "finance"."tickers"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "finance"."signal_metrics" ADD CONSTRAINT "signal_metrics_collection_id_collections_id_fk" FOREIGN KEY ("collection_id") REFERENCES "finance"."collections"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "finance"."watch_list_to_tickers" ADD CONSTRAINT "watch_list_to_tickers_watch_list_id_watch_lists_id_fk" FOREIGN KEY ("watch_list_id") REFERENCES "finance"."watch_lists"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "finance"."watch_list_to_tickers" ADD CONSTRAINT "watch_list_to_tickers_ticker_id_tickers_id_fk" FOREIGN KEY ("ticker_id") REFERENCES "finance"."tickers"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
