-- Clear the descriptions seeded by 0026 while preserving later catalogue copy.
UPDATE "products"
SET "description" = NULL, "updated_at" = now()
WHERE (
  lower(btrim("name")) IN ('invigour', 'es invigour', 'es-invigour')
  AND btrim("description") = 'Protein and balanced nutrition support to help maintain daily intake, muscle mass, and strength during treatment.'
) OR (
  lower(btrim("name")) IN ('protect', 'es fortitude protect')
  AND btrim("description") = 'Nutrition support for gut and microbiome balance during treatment.'
);
