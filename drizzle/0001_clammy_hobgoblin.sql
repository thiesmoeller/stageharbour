CREATE TABLE "venue_adaptation" (
	"id" uuid PRIMARY KEY NOT NULL,
	"workspace_id" uuid NOT NULL,
	"production_id" uuid NOT NULL,
	"venue_version_id" uuid NOT NULL
);
--> statement-breakpoint
CREATE TABLE "production" (
	"id" uuid PRIMARY KEY NOT NULL,
	"workspace_id" uuid NOT NULL,
	"name" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "scene" (
	"id" uuid PRIMARY KEY NOT NULL,
	"workspace_id" uuid NOT NULL,
	"adaptation_id" uuid NOT NULL,
	"name" text NOT NULL,
	"revision" integer DEFAULT 0 NOT NULL,
	"layout" jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "venue" (
	"id" uuid PRIMARY KEY NOT NULL,
	"workspace_id" uuid NOT NULL,
	"name" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "venue_version" (
	"id" uuid PRIMARY KEY NOT NULL,
	"workspace_id" uuid NOT NULL,
	"venue_id" uuid NOT NULL,
	"geometry" jsonb NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "adaptation_workspace_id" ON "venue_adaptation" USING btree ("workspace_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "production_workspace_id" ON "production" USING btree ("workspace_id","id");--> statement-breakpoint
CREATE INDEX "scene_workspace_idx" ON "scene" USING btree ("workspace_id");--> statement-breakpoint
CREATE UNIQUE INDEX "venue_workspace_id" ON "venue" USING btree ("workspace_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "venue_version_workspace_id" ON "venue_version" USING btree ("workspace_id","id");--> statement-breakpoint
ALTER TABLE "venue_adaptation" ADD CONSTRAINT "venue_adaptation_workspace_id_production_id_production_workspace_id_id_fk" FOREIGN KEY ("workspace_id","production_id") REFERENCES "public"."production"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "venue_adaptation" ADD CONSTRAINT "venue_adaptation_workspace_id_venue_version_id_venue_version_workspace_id_id_fk" FOREIGN KEY ("workspace_id","venue_version_id") REFERENCES "public"."venue_version"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "production" ADD CONSTRAINT "production_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scene" ADD CONSTRAINT "scene_workspace_id_adaptation_id_venue_adaptation_workspace_id_id_fk" FOREIGN KEY ("workspace_id","adaptation_id") REFERENCES "public"."venue_adaptation"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "venue" ADD CONSTRAINT "venue_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "venue_version" ADD CONSTRAINT "venue_version_workspace_id_venue_id_venue_workspace_id_id_fk" FOREIGN KEY ("workspace_id","venue_id") REFERENCES "public"."venue"("workspace_id","id") ON DELETE no action ON UPDATE no action;
