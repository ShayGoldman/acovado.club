ALTER TABLE "finance"."signal_metrics" ADD COLUMN "type" varchar(128) NOT NULL;--> statement-breakpoint
ALTER TABLE "finance"."signal_metrics" ADD COLUMN "metric" numeric(15, 4) NOT NULL;--> statement-breakpoint
ALTER TABLE "finance"."signal_metrics" DROP COLUMN IF EXISTS "updated_at";