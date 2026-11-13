CREATE TABLE "material" (
	"workspace_id" uuid NOT NULL,
	"key" text NOT NULL,
	"definition" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "material_workspace_id_key_pk" PRIMARY KEY("workspace_id","key")
);
--> statement-breakpoint
CREATE TABLE "part_definition" (
	"id" uuid NOT NULL,
	"workspace_id" uuid NOT NULL,
	"name" text NOT NULL,
	"category" text NOT NULL,
	"latest_revision" integer NOT NULL,
	"favourite" boolean DEFAULT false NOT NULL,
	"archived_at" timestamp with time zone,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "part_definition_workspace_id_id_pk" PRIMARY KEY("workspace_id","id"),
	CONSTRAINT "part_definition_latest_revision_positive" CHECK ("part_definition"."latest_revision" > 0)
);
--> statement-breakpoint
CREATE TABLE "part_revision" (
	"workspace_id" uuid NOT NULL,
	"part_id" uuid NOT NULL,
	"revision" integer NOT NULL,
	"definition" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text,
	CONSTRAINT "part_revision_workspace_id_part_id_revision_pk" PRIMARY KEY("workspace_id","part_id","revision"),
	CONSTRAINT "part_revision_revision_positive" CHECK ("part_revision"."revision" > 0)
);
--> statement-breakpoint
CREATE TABLE "stock_count" (
	"id" uuid PRIMARY KEY NOT NULL,
	"workspace_id" uuid NOT NULL,
	"material_key" text,
	"part_id" uuid,
	"variant_key" text DEFAULT '' NOT NULL,
	"quantity" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "stock_count_one_target" CHECK (("stock_count"."material_key" is not null) <> ("stock_count"."part_id" is not null)),
	CONSTRAINT "stock_count_quantity_range" CHECK ("stock_count"."quantity" >= 0)
);
--> statement-breakpoint
CREATE TABLE "stock_item" (
	"id" uuid PRIMARY KEY NOT NULL,
	"workspace_id" uuid NOT NULL,
	"label" text NOT NULL,
	"part_id" uuid NOT NULL,
	"variant_key" text DEFAULT '' NOT NULL,
	"values" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"usable" boolean DEFAULT true NOT NULL,
	"notes" text,
	"cutouts" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"finish" jsonb,
	"archived_at" timestamp with time zone,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "material" ADD CONSTRAINT "material_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "part_definition" ADD CONSTRAINT "part_definition_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "part_definition" ADD CONSTRAINT "part_definition_created_by_auth_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."auth_user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "part_revision" ADD CONSTRAINT "part_revision_created_by_auth_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."auth_user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "part_revision" ADD CONSTRAINT "part_revision_part_fk" FOREIGN KEY ("workspace_id","part_id") REFERENCES "public"."part_definition"("workspace_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_count" ADD CONSTRAINT "stock_count_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_count" ADD CONSTRAINT "stock_count_material_fk" FOREIGN KEY ("workspace_id","material_key") REFERENCES "public"."material"("workspace_id","key") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_count" ADD CONSTRAINT "stock_count_part_fk" FOREIGN KEY ("workspace_id","part_id") REFERENCES "public"."part_definition"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_item" ADD CONSTRAINT "stock_item_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_item" ADD CONSTRAINT "stock_item_created_by_auth_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."auth_user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_item" ADD CONSTRAINT "stock_item_part_fk" FOREIGN KEY ("workspace_id","part_id") REFERENCES "public"."part_definition"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "part_definition_workspace_idx" ON "part_definition" USING btree ("workspace_id","archived_at");--> statement-breakpoint
CREATE UNIQUE INDEX "stock_count_material" ON "stock_count" USING btree ("workspace_id","material_key") WHERE "stock_count"."material_key" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "stock_count_part_variant" ON "stock_count" USING btree ("workspace_id","part_id","variant_key") WHERE "stock_count"."part_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "stock_item_workspace_id" ON "stock_item" USING btree ("workspace_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "stock_item_workspace_label" ON "stock_item" USING btree ("workspace_id","label") WHERE "stock_item"."archived_at" is null;--> statement-breakpoint
CREATE INDEX "stock_item_part_idx" ON "stock_item" USING btree ("workspace_id","part_id");--> statement-breakpoint
CREATE FUNCTION "part_revision_immutable"() RETURNS trigger AS $$
BEGIN
	RAISE EXCEPTION 'part_revision rows are immutable; save a new revision instead' USING ERRCODE = 'restrict_violation';
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
CREATE TRIGGER "part_revision_immutable" BEFORE UPDATE ON "part_revision" FOR EACH ROW EXECUTE FUNCTION "part_revision_immutable"();
