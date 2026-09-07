CREATE TABLE "invitation" (
	"id" uuid PRIMARY KEY NOT NULL,
	"workspace_id" uuid NOT NULL,
	"email" text NOT NULL,
	"name" text NOT NULL,
	"role" "workspace_role" NOT NULL,
	"token_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"consumed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "password_reset" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"token_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"consumed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "invitation" ADD CONSTRAINT "invitation_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "password_reset" ADD CONSTRAINT "password_reset_user_id_auth_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."auth_user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "invitation_workspace_id" ON "invitation" USING btree ("workspace_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "invitation_token_hash" ON "invitation" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "invitation_workspace_email_idx" ON "invitation" USING btree ("workspace_id","email");--> statement-breakpoint
CREATE UNIQUE INDEX "password_reset_token_hash" ON "password_reset" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "password_reset_user_idx" ON "password_reset" USING btree ("user_id");