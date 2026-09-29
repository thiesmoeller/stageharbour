ALTER TABLE "inventory_panel" ADD COLUMN "cutouts" jsonb DEFAULT '[]'::jsonb NOT NULL;
--> statement-breakpoint
ALTER TABLE "inventory_panel" ADD COLUMN "current_finish" jsonb;
