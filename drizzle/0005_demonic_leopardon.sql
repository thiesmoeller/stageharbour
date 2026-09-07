CREATE TABLE "venue_reference" (
	"id" uuid PRIMARY KEY NOT NULL,
	"workspace_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"media_type" text NOT NULL,
	"original_name" text NOT NULL,
	"storage_key" text NOT NULL,
	"page_count" integer,
	"pixel_width" integer,
	"pixel_height" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "venue_reference" ADD CONSTRAINT "venue_reference_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "venue_reference_workspace_id" ON "venue_reference" USING btree ("workspace_id","id");