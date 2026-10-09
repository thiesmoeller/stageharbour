CREATE TABLE "surface_definition" (
	"id" uuid PRIMARY KEY NOT NULL,
	"workspace_id" uuid NOT NULL,
	"production_id" uuid,
	"name" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"definition" jsonb NOT NULL,
	"archived" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "surface_texture_file" (
	"id" uuid PRIMARY KEY NOT NULL,
	"workspace_id" uuid NOT NULL,
	"media_type" text NOT NULL,
	"original_name" text NOT NULL,
	"storage_key" text NOT NULL,
	"pixel_width" integer NOT NULL,
	"pixel_height" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "surface_definition" ADD CONSTRAINT "surface_definition_workspace_id_production_id_production_workspace_id_id_fk" FOREIGN KEY ("workspace_id","production_id") REFERENCES "public"."production"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "surface_texture_file" ADD CONSTRAINT "surface_texture_file_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "surface_definition_workspace_id" ON "surface_definition" USING btree ("workspace_id","id");--> statement-breakpoint
CREATE INDEX "surface_definition_scope_idx" ON "surface_definition" USING btree ("workspace_id","production_id","archived");--> statement-breakpoint
CREATE UNIQUE INDEX "surface_texture_file_workspace_id" ON "surface_texture_file" USING btree ("workspace_id","id");