ALTER TABLE "workspace" ALTER COLUMN "product_name" SET DEFAULT 'StageHarbour';--> statement-breakpoint
UPDATE "workspace" SET "product_name" = 'StageHarbour' WHERE "product_name" = 'Bühnenplaner';
