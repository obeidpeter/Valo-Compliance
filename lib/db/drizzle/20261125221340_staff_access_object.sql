-- ADM-009 (docs/architecture/audit-trail.md): each staff access row names what was read or acted on. Rows
-- written before this column existed did not record it, so they read "unrecorded"; the default is only for
-- them and is dropped at once, so every new row must name its object. Adding a column fires no row trigger,
-- so the append-only guard on this table is not bypassed.
ALTER TABLE "valo_staff_access_audit" ADD COLUMN "object" text NOT NULL DEFAULT 'unrecorded';--> statement-breakpoint
ALTER TABLE "valo_staff_access_audit" ALTER COLUMN "object" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "valo_staff_access_audit" ADD CONSTRAINT "valo_staff_access_audit_object_check" CHECK ("valo_staff_access_audit"."object" ~ '^[a-z][a-z_]*(:[^[:space:]]{1,200})?$');
