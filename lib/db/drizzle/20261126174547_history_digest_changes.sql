CREATE TABLE "valo_history_digest_changes" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"table_name" text NOT NULL,
	"shard" smallint NOT NULL,
	"row_count" bigint NOT NULL,
	"hash_sum" numeric NOT NULL,
	CONSTRAINT "valo_history_digest_changes_shard_check" CHECK ("valo_history_digest_changes"."shard" BETWEEN 0 AND 15)
);
