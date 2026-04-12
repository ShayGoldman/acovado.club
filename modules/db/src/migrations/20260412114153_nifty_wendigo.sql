CREATE SCHEMA "acovado";
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "acovado"."content_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source_id" uuid NOT NULL,
	"external_id" text NOT NULL,
	"title" text,
	"body" text,
	"url" text NOT NULL,
	"published_at" timestamp with time zone,
	"processed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "content_items_source_external_unique" UNIQUE("source_id","external_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "acovado"."inference_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text,
	"model" text NOT NULL,
	"config" jsonb,
	"prompt" text NOT NULL,
	"response" jsonb,
	"duration_ms" numeric(10, 2) NOT NULL,
	"status" text NOT NULL,
	"error" text,
	"retry_count" integer DEFAULT 0 NOT NULL,
	"metadata" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "acovado"."mentions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"content_item_id" uuid NOT NULL,
	"ticker_symbol" text NOT NULL,
	"confidence" numeric(4, 3) NOT NULL,
	"is_explicit" boolean NOT NULL,
	"raw_context" text,
	"mentioned_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "acovado"."sources" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" text NOT NULL,
	"external_id" text NOT NULL,
	"display_name" text NOT NULL,
	"config" jsonb,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sources_kind_external_id_unique" UNIQUE("kind","external_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "acovado"."tickers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"symbol" text NOT NULL,
	"company_name" text NOT NULL,
	"exchange" text,
	"cik" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tickers_symbol_unique" UNIQUE("symbol")
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "acovado"."content_items" ADD CONSTRAINT "content_items_source_id_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "acovado"."sources"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "acovado"."mentions" ADD CONSTRAINT "mentions_content_item_id_content_items_id_fk" FOREIGN KEY ("content_item_id") REFERENCES "acovado"."content_items"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "acovado"."mentions" ADD CONSTRAINT "mentions_ticker_symbol_tickers_symbol_fk" FOREIGN KEY ("ticker_symbol") REFERENCES "acovado"."tickers"("symbol") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "content_items_processed_at_idx" ON "acovado"."content_items" USING btree ("processed_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "mentions_ticker_symbol_idx" ON "acovado"."mentions" USING btree ("ticker_symbol");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "mentions_mentioned_at_idx" ON "acovado"."mentions" USING btree ("mentioned_at");