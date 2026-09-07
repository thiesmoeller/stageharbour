CREATE TYPE "public"."construction_export_status" AS ENUM('pending', 'ready', 'failed');--> statement-breakpoint
CREATE UNIQUE INDEX "scene_workspace_id" ON "scene" USING btree ("workspace_id","id");--> statement-breakpoint
CREATE TABLE "construction_plan_revision" (
	"id" uuid PRIMARY KEY NOT NULL,
	"workspace_id" uuid NOT NULL,
	"scene_id" uuid NOT NULL,
	"name" text NOT NULL,
	"scale" integer NOT NULL,
	"status" "construction_export_status" NOT NULL,
	"snapshot" jsonb NOT NULL,
	"storage_key" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "construction_plan_revision" ADD CONSTRAINT "construction_plan_revision_workspace_id_scene_id_scene_workspace_id_id_fk" FOREIGN KEY ("workspace_id","scene_id") REFERENCES "public"."scene"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "construction_plan_scene_idx" ON "construction_plan_revision" USING btree ("workspace_id","scene_id");--> statement-breakpoint
CREATE UNIQUE INDEX "construction_plan_workspace_id" ON "construction_plan_revision" USING btree ("workspace_id","id");