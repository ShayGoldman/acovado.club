CREATE TYPE "acovado"."grading_status" AS ENUM('success', 'error');--> statement-breakpoint
CREATE TYPE "acovado"."inference_status" AS ENUM('success', 'error');--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "acovado"."grading_logs" (
	"id" serial PRIMARY KEY NOT NULL,
	"inference_log_id" integer NOT NULL,
	"grader_model" varchar(128) NOT NULL,
	"grader_config" jsonb NOT NULL,
	"grader_prompt" jsonb NOT NULL,
	"confidence" varchar(32),
	"passed" boolean,
	"feedback" text,
	"reasoning" text,
	"duration_ms" numeric(10, 2) NOT NULL,
	"status" "acovado"."grading_status" NOT NULL,
	"error" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "acovado"."inference_logs" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" varchar(256),
	"model" varchar(128) NOT NULL,
	"config" jsonb NOT NULL,
	"prompt" jsonb NOT NULL,
	"response" jsonb,
	"duration_ms" numeric(10, 2) NOT NULL,
	"status" "acovado"."inference_status" NOT NULL,
	"error" text,
	"retry_count" integer DEFAULT 0 NOT NULL,
	"metadata" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "acovado"."grading_logs" ADD CONSTRAINT "grading_logs_inference_log_id_inference_logs_id_fk" FOREIGN KEY ("inference_log_id") REFERENCES "acovado"."inference_logs"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
