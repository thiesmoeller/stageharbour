ALTER TABLE "workspace" ADD COLUMN "product_name" text DEFAULT 'Bühnenplaner' NOT NULL;--> statement-breakpoint
ALTER TABLE "workspace" ADD COLUMN "tagline" text DEFAULT 'GEMEINSAM THEATER MACHEN' NOT NULL;--> statement-breakpoint
ALTER TABLE "workspace" ADD COLUMN "footer_text" text DEFAULT 'Für die Bühne. Für die Menschen dahinter.' NOT NULL;--> statement-breakpoint
ALTER TABLE "workspace" ADD COLUMN "logo_storage_key" text;--> statement-breakpoint
ALTER TABLE "workspace" ADD COLUMN "logo_media_type" text;