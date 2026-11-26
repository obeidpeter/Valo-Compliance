-- docs/architecture/alerts.md, part 2 (SEC-005, SEC-008, the security baseline's v5.0.0-16.3.3): the API
-- counts a refusal by a limit (429) as a security signal of the kind limit_refusal, and an answer refusing
-- a request's input (400, 413, 415 or 422) as refused_input, for the alerts on abuse spread over many
-- callers and on one caller's refused input. The kind check takes the two new kinds too. The table holds
-- only rows of the first three kinds, which the new check keeps.
ALTER TABLE "valo_security_signals" DROP CONSTRAINT "valo_security_signals_kind_check";--> statement-breakpoint
ALTER TABLE "valo_security_signals" ADD CONSTRAINT "valo_security_signals_kind_check" CHECK ("valo_security_signals"."kind" IN ('denied_access', 'signature_failure', 'guard_refusal', 'limit_refusal', 'refused_input'));