CREATE TABLE "valo_rule_changes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"rule_id" text NOT NULL,
	"version" integer NOT NULL,
	"kind" text NOT NULL,
	"replacement_version" integer,
	"reason" text NOT NULL,
	"recorded_by" text NOT NULL,
	"recorded_at" timestamp with time zone DEFAULT now() NOT NULL,
	"workspaces" integer DEFAULT 0 NOT NULL,
	"results" integer DEFAULT 0 NOT NULL,
	"tasks" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "valo_rule_change_shape" CHECK ("valo_rule_changes"."kind" IN ('replaced', 'withdrawn') AND (("valo_rule_changes"."kind" = 'replaced') = ("valo_rule_changes"."replacement_version" IS NOT NULL)) AND ("valo_rule_changes"."replacement_version" IS NULL OR "valo_rule_changes"."replacement_version" > "valo_rule_changes"."version") AND char_length("valo_rule_changes"."reason") BETWEEN 20 AND 1000 AND "valo_rule_changes"."workspaces" >= 0 AND "valo_rule_changes"."results" >= 0 AND "valo_rule_changes"."tasks" >= 0)
);
--> statement-breakpoint
CREATE INDEX "valo_rule_change_version" ON "valo_rule_changes" USING btree ("rule_id","version");--> statement-breakpoint
-- A rule change's record is never changed or removed (docs/architecture/rule-changes.md, slice 1).
CREATE FUNCTION public.valo_rule_change_immutable() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  RAISE EXCEPTION 'A rule change''s record is never changed or removed' USING ERRCODE = '23514';
END $$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.valo_rule_change_immutable() FROM PUBLIC;--> statement-breakpoint
CREATE TRIGGER valo_rule_change_immutable BEFORE UPDATE OR DELETE ON public.valo_rule_changes
FOR EACH ROW EXECUTE FUNCTION public.valo_rule_change_immutable();--> statement-breakpoint
CREATE TRIGGER valo_rule_change_no_truncate BEFORE TRUNCATE ON public.valo_rule_changes
FOR EACH STATEMENT EXECUTE FUNCTION public.valo_rule_change_immutable();--> statement-breakpoint
-- A record is written for a version that is published now, at the time of the transaction that writes
-- it, whatever time it names. The database counts, as it is written, the workspaces, saved results and
-- tasks made under that version, whatever counts it names. It runs as the table's owner, so that the
-- session making the change needs no right to the workspaces' rows.
CREATE FUNCTION public.valo_rule_change_record() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  IF NOT EXISTS (
    SELECT FROM public.valo_rule_releases r
     WHERE r.rule_id = NEW.rule_id AND r.version = NEW.version AND r.status = 'published'
  ) THEN
    RAISE EXCEPTION 'Only a published rule version has a change to record' USING ERRCODE = '23514';
  END IF;
  NEW.recorded_at := now();
  SELECT count(DISTINCT affected.workspace_id)::integer,
         count(*) FILTER (WHERE affected.kind = 'result')::integer,
         count(*) FILTER (WHERE affected.kind = 'task')::integer
    INTO NEW.workspaces, NEW.results, NEW.tasks
  FROM (
    SELECT a.workspace_id, 'result' AS kind
      FROM public.valo_assessments a
     WHERE EXISTS (
       SELECT FROM jsonb_array_elements(a.result->'items') i
        WHERE i->>'ruleId' = NEW.rule_id AND i->>'ruleVersion' = NEW.version::text)
    UNION ALL
    SELECT t.workspace_id, 'task'
      FROM public.valo_tasks t
     WHERE t.rule_id = NEW.rule_id AND t.rule_version = NEW.version AND t.deleted_at IS NULL
  ) affected;
  RETURN NEW;
END $$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.valo_rule_change_record() FROM PUBLIC;--> statement-breakpoint
CREATE TRIGGER valo_rule_change_record BEFORE INSERT ON public.valo_rule_changes
FOR EACH ROW EXECUTE FUNCTION public.valo_rule_change_record();--> statement-breakpoint
-- A released version leaves the requirements check, superseded or withdrawn, only with its record,
-- written in the same transaction. A replaced version's record names a version of the same rule that
-- is published by then. So every route that changes a rule gives its reason.
CREATE FUNCTION public.valo_rule_change_required() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE change text;
BEGIN
  IF OLD.status IS DISTINCT FROM 'published' OR NEW.status NOT IN ('superseded', 'withdrawn') THEN
    RETURN NULL;
  END IF;
  change := CASE NEW.status WHEN 'superseded' THEN 'replaced' ELSE 'withdrawn' END;
  IF NOT EXISTS (
    SELECT FROM public.valo_rule_changes c
     WHERE c.rule_id = NEW.rule_id AND c.version = NEW.version AND c.kind = change
       AND c.recorded_at = now()
       AND (c.kind = 'withdrawn' OR EXISTS (
         SELECT FROM public.valo_rule_releases r
          WHERE r.rule_id = NEW.rule_id AND r.version = c.replacement_version AND r.status = 'published'))
  ) THEN
    RAISE EXCEPTION 'A rule version leaves the requirements check only with the reason recorded for it in the same transaction'
      USING ERRCODE = '23514';
  END IF;
  RETURN NULL;
END $$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.valo_rule_change_required() FROM PUBLIC;--> statement-breakpoint
CREATE TRIGGER valo_rule_change_required AFTER UPDATE OF status ON public.valo_rule_releases
FOR EACH ROW EXECUTE FUNCTION public.valo_rule_change_required();
