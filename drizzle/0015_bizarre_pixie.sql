CREATE TABLE "inventory_ballast" (
	"workspace_id" uuid PRIMARY KEY NOT NULL,
	"slabs" integer DEFAULT 0 NOT NULL,
	"straps" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
ALTER TABLE "inventory_ballast" ADD CONSTRAINT "inventory_ballast_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE no action ON UPDATE no action;