CREATE TABLE "inventory_wall_type" (
	"id" uuid PRIMARY KEY NOT NULL,
	"workspace_id" uuid NOT NULL,
	"definition" jsonb NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "inventory_wall_type_workspace_id" ON "inventory_wall_type" USING btree ("workspace_id","id");--> statement-breakpoint
CREATE TABLE "inventory_panel" (
	"id" uuid PRIMARY KEY NOT NULL,
	"workspace_id" uuid NOT NULL,
	"type_id" uuid NOT NULL,
	"label" text NOT NULL,
	"available" boolean DEFAULT true NOT NULL,
	"note" text
);
--> statement-breakpoint
CREATE UNIQUE INDEX "inventory_panel_workspace_id" ON "inventory_panel" USING btree ("workspace_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "inventory_panel_workspace_label" ON "inventory_panel" USING btree ("workspace_id","label");--> statement-breakpoint
CREATE INDEX "inventory_panel_type_idx" ON "inventory_panel" USING btree ("workspace_id","type_id");--> statement-breakpoint
ALTER TABLE "inventory_wall_type" ADD CONSTRAINT "inventory_wall_type_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_panel" ADD CONSTRAINT "inventory_panel_workspace_id_type_id_inventory_wall_type_workspace_id_id_fk" FOREIGN KEY ("workspace_id","type_id") REFERENCES "public"."inventory_wall_type"("workspace_id","id") ON DELETE no action ON UPDATE no action;
