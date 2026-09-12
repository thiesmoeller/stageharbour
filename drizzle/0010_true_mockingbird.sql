CREATE TABLE "asset_file" (
	"id" uuid PRIMARY KEY NOT NULL,
	"workspace_id" uuid NOT NULL,
	"storage_key" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "inventory_asset" (
	"id" uuid PRIMARY KEY NOT NULL,
	"workspace_id" uuid NOT NULL,
	"name" text NOT NULL,
	"definition" jsonb NOT NULL,
	"archived" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
ALTER TABLE "asset_file" ADD CONSTRAINT "asset_file_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_asset" ADD CONSTRAINT "inventory_asset_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "asset_file_workspace_idx" ON "asset_file" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "inventory_asset_workspace_idx" ON "inventory_asset" USING btree ("workspace_id");