CREATE TABLE "construction_package" (
	"id" uuid PRIMARY KEY NOT NULL,
	"workspace_id" uuid NOT NULL,
	"production_id" uuid NOT NULL,
	"name" text NOT NULL,
	"scale" integer NOT NULL,
	"status" "construction_export_status" NOT NULL,
	"snapshot" jsonb NOT NULL,
	"storage_key" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "construction_package" ADD CONSTRAINT "construction_package_workspace_id_production_id_production_workspace_id_id_fk" FOREIGN KEY ("workspace_id","production_id") REFERENCES "public"."production"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "construction_package_production_idx" ON "construction_package" USING btree ("workspace_id","production_id");--> statement-breakpoint
CREATE UNIQUE INDEX "construction_package_workspace_id" ON "construction_package" USING btree ("workspace_id","id");