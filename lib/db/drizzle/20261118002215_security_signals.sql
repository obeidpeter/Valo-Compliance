CREATE TABLE "valo_security_signals" (
	"kind" text NOT NULL,
	"subject_hash" text NOT NULL,
	"window_started_at" timestamp with time zone NOT NULL,
	"count" integer NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	CONSTRAINT "valo_security_signals_kind_subject_hash_window_started_at_pk" PRIMARY KEY("kind","subject_hash","window_started_at"),
	CONSTRAINT "valo_security_signals_kind_check" CHECK ("valo_security_signals"."kind" IN ('denied_access', 'signature_failure')),
	CONSTRAINT "valo_security_signals_count_check" CHECK ("valo_security_signals"."count" > 0),
	CONSTRAINT "valo_security_signals_subject_hash_check" CHECK ("valo_security_signals"."subject_hash" ~ '^[a-f0-9]{64}$')
);
--> statement-breakpoint
CREATE INDEX "valo_security_signals_expiry_idx" ON "valo_security_signals" USING btree ("expires_at");