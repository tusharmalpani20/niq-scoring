CREATE TABLE "admin_auth_attempts" (
	"key" varchar(100) PRIMARY KEY NOT NULL,
	"count" integer NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "admin_invitations" (
	"id" varchar(26) PRIMARY KEY NOT NULL,
	"email" varchar(254) NOT NULL,
	"display_name" varchar(120) NOT NULL,
	"token_hash" varchar(64) NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "admin_invitations_email_unique" UNIQUE("email"),
	CONSTRAINT "admin_invitations_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "admin_sessions" (
	"token_hash" varchar(64) PRIMARY KEY NOT NULL,
	"user_id" varchar(26) NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "admin_users" (
	"id" varchar(26) PRIMARY KEY NOT NULL,
	"email" varchar(254) NOT NULL,
	"display_name" varchar(120) NOT NULL,
	"password_hash" varchar(255) NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "admin_users_email_unique" UNIQUE("email"),
	CONSTRAINT "admin_users_normalized_email_ck" CHECK ("admin_users"."email" = lower(trim("admin_users"."email")))
);
--> statement-breakpoint
ALTER TABLE "admin_sessions" ADD CONSTRAINT "admin_sessions_user_id_admin_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."admin_users"("id") ON DELETE no action ON UPDATE no action;
