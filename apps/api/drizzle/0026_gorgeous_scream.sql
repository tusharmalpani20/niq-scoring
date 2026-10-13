ALTER TABLE "products" ADD COLUMN "description" text;--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "aliases" text[] DEFAULT '{}'::text[] NOT NULL;
--> statement-breakpoint
UPDATE "products"
SET "name" = 'Es Invigour',
    "description" = COALESCE(NULLIF(btrim("description"), ''), 'Protein and balanced nutrition support to help maintain daily intake, muscle mass, and strength during treatment.'),
    "aliases" = CASE WHEN 'Invigour' = ANY("aliases") THEN "aliases" ELSE array_append("aliases", 'Invigour') END,
    "updated_at" = now()
WHERE lower(btrim("name")) = 'invigour'
  AND NOT EXISTS (SELECT 1 FROM "products" AS existing WHERE existing.id <> "products".id AND lower(btrim(existing.name)) = 'es invigour');
--> statement-breakpoint
UPDATE "products"
SET "name" = 'Es Fortitude Protect',
    "description" = COALESCE(NULLIF(btrim("description"), ''), 'Nutrition support for gut and microbiome balance during treatment.'),
    "aliases" = CASE WHEN 'Protect' = ANY("aliases") THEN "aliases" ELSE array_append("aliases", 'Protect') END,
    "updated_at" = now()
WHERE lower(btrim("name")) = 'protect'
  AND NOT EXISTS (SELECT 1 FROM "products" AS existing WHERE existing.id <> "products".id AND lower(btrim(existing.name)) = 'es fortitude protect');
