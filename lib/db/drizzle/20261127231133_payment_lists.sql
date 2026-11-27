CREATE TABLE "valo_payment_lists" (
	"day" text PRIMARY KEY NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"last_attempt_at" timestamp with time zone,
	"pages" integer,
	"transactions" integer,
	"unmatched" integer,
	"finding" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	CONSTRAINT "valo_payment_lists_day_check" CHECK ("valo_payment_lists"."day" ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'),
	CONSTRAINT "valo_payment_lists_status_check" CHECK ("valo_payment_lists"."status" IN ('pending', 'listed', 'needs_review')),
	CONSTRAINT "valo_payment_lists_attempts_check" CHECK ("valo_payment_lists"."attempts" BETWEEN 0 AND 3)
);
