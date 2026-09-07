CREATE TABLE "editing_lease" (
	"workspace_id" uuid NOT NULL,
	"resource_kind" text NOT NULL,
	"resource_id" uuid NOT NULL,
	"holder_user_id" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	CONSTRAINT "editing_lease_workspace_id_resource_kind_resource_id_pk" PRIMARY KEY("workspace_id","resource_kind","resource_id")
);
--> statement-breakpoint
ALTER TABLE "editing_lease" ADD CONSTRAINT "editing_lease_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "editing_lease" ADD CONSTRAINT "editing_lease_holder_user_id_auth_user_id_fk" FOREIGN KEY ("holder_user_id") REFERENCES "public"."auth_user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "editing_lease_holder_idx" ON "editing_lease" USING btree ("holder_user_id");--> statement-breakpoint
CREATE INDEX "editing_lease_expiry_idx" ON "editing_lease" USING btree ("expires_at");