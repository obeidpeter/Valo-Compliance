CREATE TABLE "valo_history_checks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"checked_at" timestamp with time zone DEFAULT now() NOT NULL,
	"mismatched" text[] NOT NULL
);
--> statement-breakpoint
CREATE TABLE "valo_history_digests" (
	"table_name" text NOT NULL,
	"shard" smallint NOT NULL,
	"row_count" bigint NOT NULL,
	"hash_sum" numeric NOT NULL,
	CONSTRAINT "valo_history_digests_table_name_shard_pk" PRIMARY KEY("table_name","shard"),
	CONSTRAINT "valo_history_digests_shard_check" CHECK ("valo_history_digests"."shard" BETWEEN 0 AND 15)
);
--> statement-breakpoint
CREATE INDEX "valo_history_checks_checked_idx" ON "valo_history_checks" USING btree ("checked_at");