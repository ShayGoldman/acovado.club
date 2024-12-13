ALTER TABLE "finance"."collections" ADD COLUMN "type" varchar(64) NOT NULL;--> statement-breakpoint
ALTER TABLE "finance"."collections" ADD COLUMN "data" jsonb NOT NULL;