ALTER TABLE products ADD COLUMN benefits text[] NOT NULL DEFAULT '{}'::text[];
--> statement-breakpoint
ALTER TABLE products ADD COLUMN image_data_url text;
