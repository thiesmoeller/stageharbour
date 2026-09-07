CREATE TABLE "scene_template" (
	"id" uuid PRIMARY KEY NOT NULL,
	"workspace_id" uuid NOT NULL,
	"name" text NOT NULL,
	"layout" jsonb NOT NULL,
	"source_surfaces" jsonb NOT NULL
);
--> statement-breakpoint
ALTER TABLE "scene_template" ADD CONSTRAINT "scene_template_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "scene_template_workspace_id" ON "scene_template" USING btree ("workspace_id","id");--> statement-breakpoint
CREATE INDEX "scene_template_workspace_idx" ON "scene_template" USING btree ("workspace_id");