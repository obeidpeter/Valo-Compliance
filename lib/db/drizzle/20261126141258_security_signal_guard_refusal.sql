-- ADM-009 (docs/architecture/audit-trail.md, slice 3): the error handler counts a database guard's
-- refusal as a security signal of the kind guard_refusal, which raises GUARD_REFUSALS_DETECTED, but the
-- kind check took only the first two kinds, so every such count was refused and none was kept. It now
-- takes the third. The table holds only rows of the first two kinds, which the new check keeps.
ALTER TABLE "valo_security_signals" DROP CONSTRAINT "valo_security_signals_kind_check";--> statement-breakpoint
ALTER TABLE "valo_security_signals" ADD CONSTRAINT "valo_security_signals_kind_check" CHECK ("valo_security_signals"."kind" IN ('denied_access', 'signature_failure', 'guard_refusal'));