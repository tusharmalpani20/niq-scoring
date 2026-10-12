CREATE TABLE "products" (
	"id" varchar(26) PRIMARY KEY NOT NULL,
	"name" varchar(120) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "products_name_uq" ON "products" USING btree (lower(btrim("name")));
--> statement-breakpoint
INSERT INTO "products" ("id", "name") VALUES
  ('01M4R0GS00NW8D0F01P9AMTKSM', 'Invigour'),
  ('01M4R0GS01P79N0MSMK1E7PPAV', 'Nourish'),
  ('01M4R0GS0106RM509ZNTZB1REP', 'Protect'),
  ('01M4R0GS013Q5HS5C9DP0T5NXR', 'Recover'),
  ('01M4R0GS02R3ZFCBP3D9M5G0NR', 'Liss WH');
