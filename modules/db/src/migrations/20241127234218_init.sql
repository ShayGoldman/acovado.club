CREATE SCHEMA "finance";
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "finance"."tickers" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "finance"."tickers_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"name" varchar(64) NOT NULL,
	"symbol" varchar(8) NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "tickers_symbol_unique" UNIQUE("symbol")
);
