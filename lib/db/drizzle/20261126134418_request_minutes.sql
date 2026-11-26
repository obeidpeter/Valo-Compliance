CREATE TABLE "valo_request_minutes" (
	"minute" timestamp with time zone PRIMARY KEY NOT NULL,
	"requests" integer NOT NULL,
	"failures" integer NOT NULL,
	"within_100ms" integer NOT NULL,
	"within_250ms" integer NOT NULL,
	"within_500ms" integer NOT NULL,
	"within_1s" integer NOT NULL,
	"within_2500ms" integer NOT NULL,
	"within_5s" integer NOT NULL,
	"within_10s" integer NOT NULL,
	CONSTRAINT "valo_request_minutes_minute_check" CHECK ("valo_request_minutes"."minute" = date_trunc('minute', "valo_request_minutes"."minute")),
	CONSTRAINT "valo_request_minutes_counts_check" CHECK (0 <= "valo_request_minutes"."failures" AND "valo_request_minutes"."failures" <= "valo_request_minutes"."requests"
        AND 0 <= "valo_request_minutes"."within_100ms" AND "valo_request_minutes"."within_100ms" <= "valo_request_minutes"."within_250ms"
        AND "valo_request_minutes"."within_250ms" <= "valo_request_minutes"."within_500ms" AND "valo_request_minutes"."within_500ms" <= "valo_request_minutes"."within_1s"
        AND "valo_request_minutes"."within_1s" <= "valo_request_minutes"."within_2500ms" AND "valo_request_minutes"."within_2500ms" <= "valo_request_minutes"."within_5s"
        AND "valo_request_minutes"."within_5s" <= "valo_request_minutes"."within_10s" AND "valo_request_minutes"."within_10s" <= "valo_request_minutes"."requests")
);
