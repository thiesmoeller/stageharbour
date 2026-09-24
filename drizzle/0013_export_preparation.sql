CREATE TABLE "export_preparation" (
	"id" uuid PRIMARY KEY NOT NULL,
	"workspace_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"scene_id" uuid,
	"production_id" uuid,
	"status" text NOT NULL,
	"revision_name" text NOT NULL,
	"spec" jsonb NOT NULL,
	"frozen" jsonb NOT NULL,
	"fingerprint" text NOT NULL,
	"manifest" jsonb,
	"storage_key" text,
	"error" text,
	"stage" text DEFAULT 'queued' NOT NULL,
	"page_count" integer,
	"metrics" jsonb,
	"queued_at" timestamp with time zone NOT NULL,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"expires_at" timestamp with time zone NOT NULL,
	"issued_revision_id" uuid
);
--> statement-breakpoint
ALTER TABLE "export_preparation" ADD CONSTRAINT "export_preparation_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "export_preparation_workspace_idx" ON "export_preparation" USING btree ("workspace_id","expires_at");
