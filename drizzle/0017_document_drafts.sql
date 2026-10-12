CREATE TABLE "document_draft" (
	"id" uuid PRIMARY KEY NOT NULL,
	"workspace_id" uuid NOT NULL,
	"production_id" uuid NOT NULL,
	"draft" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "document_draft" ADD CONSTRAINT "document_draft_production_fk" FOREIGN KEY ("workspace_id","production_id") REFERENCES "public"."production"("workspace_id","id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX "document_draft_workspace_production" ON "document_draft" USING btree ("workspace_id","production_id");
