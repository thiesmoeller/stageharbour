CREATE TABLE "audit_event" (
	"id" uuid PRIMARY KEY NOT NULL,
	"workspace_id" uuid NOT NULL,
	"actor_id" text NOT NULL,
	"action" text NOT NULL,
	"resource_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "audit_event" ADD CONSTRAINT "audit_event_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "audit_workspace_created_idx" ON "audit_event" USING btree ("workspace_id","created_at");