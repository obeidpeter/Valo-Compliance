CREATE TABLE "valo_rule_notices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"rule_id" text NOT NULL,
	"version" integer NOT NULL,
	"kind" text NOT NULL,
	"replacement_version" integer,
	"title" text NOT NULL,
	"reason" text NOT NULL,
	"results" integer NOT NULL,
	"tasks" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"read_at" timestamp with time zone,
	CONSTRAINT "valo_rule_notice_shape" CHECK ("valo_rule_notices"."kind" IN ('replaced', 'withdrawn') AND (("valo_rule_notices"."kind" = 'replaced') = ("valo_rule_notices"."replacement_version" IS NOT NULL)) AND "valo_rule_notices"."results" >= 0 AND "valo_rule_notices"."tasks" >= 0 AND ("valo_rule_notices"."results" > 0 OR "valo_rule_notices"."tasks" > 0))
);
--> statement-breakpoint
ALTER TABLE "valo_rule_notices" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "valo_rule_notices" ADD CONSTRAINT "valo_rule_notices_workspace_id_valo_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."valo_workspaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "valo_rule_notice_once" ON "valo_rule_notices" USING btree ("workspace_id","rule_id","version","kind");--> statement-breakpoint
CREATE INDEX "valo_rule_notice_workspace" ON "valo_rule_notices" USING btree ("workspace_id","created_at");--> statement-breakpoint
CREATE POLICY "valo_workspace_scope" ON "valo_rule_notices" AS PERMISSIVE FOR ALL TO "valo_workspace_scope" USING ("valo_rule_notices"."workspace_id" = (select valo_scope_workspace())) WITH CHECK ("valo_rule_notices"."workspace_id" = (select valo_scope_workspace()));--> statement-breakpoint
-- When a released requirements-check rule version is replaced or withdrawn, in the transaction that
-- makes the change, whoever makes it (docs/architecture/rule-changes.md, slice 2):
-- - each live task made under that version is marked for review, and its unsent reminders are called
--   off. A task is never deleted and its dates are not changed (RUL-009). Each mark is an event in its
--   workspace's log, as a mark made when the workspace's tasks are read is;
-- - each workspace that saved a result listing that version, or made a task from it, gets one notice,
--   with the change's reason and how many of its saved results and tasks were made under it. A
--   workspace whose data was erased gets none.
-- A change without its record is refused by valo_rule_change_required, which runs after this, so
-- this writes nothing for one. It runs as the tables' owner, so that the session making the change
-- needs no right to the workspaces' rows.
CREATE FUNCTION public.valo_note_rule_change() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE change public.valo_rule_changes%ROWTYPE;
BEGIN
  IF OLD.status IS DISTINCT FROM 'published' OR NEW.status NOT IN ('superseded', 'withdrawn') THEN
    RETURN NULL;
  END IF;
  SELECT * INTO change FROM public.valo_rule_changes c
   WHERE c.rule_id = NEW.rule_id AND c.version = NEW.version
     AND c.kind = CASE NEW.status WHEN 'superseded' THEN 'replaced' ELSE 'withdrawn' END
     AND c.recorded_at = now()
   ORDER BY c.id
   LIMIT 1;
  IF NOT FOUND THEN RETURN NULL; END IF;
  INSERT INTO public.valo_rule_notices(workspace_id, rule_id, version, kind, replacement_version, title,
    reason, results, tasks)
  SELECT affected.workspace_id, NEW.rule_id, NEW.version, change.kind, change.replacement_version,
    coalesce(nullif(NEW.rule->>'title', ''), NEW.rule_id), change.reason,
    count(*) FILTER (WHERE affected.kind = 'result')::integer,
    count(*) FILTER (WHERE affected.kind = 'task')::integer
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
  ) affected
  WHERE NOT EXISTS (
    SELECT FROM public.valo_privacy_tombstones p WHERE p.workspace_id = affected.workspace_id)
  GROUP BY affected.workspace_id
  ON CONFLICT (workspace_id, rule_id, version, kind) DO NOTHING;
  UPDATE public.valo_reminder_outbox o
     SET status = 'cancelled', reason = 'SOURCE_NO_LONGER_ELIGIBLE', lease_token = NULL,
         lease_until = NULL, next_attempt_at = NULL
    FROM public.valo_tasks t
   WHERE o.task_id = t.id AND o.workspace_id = t.workspace_id
     AND t.rule_id = NEW.rule_id AND t.rule_version = NEW.version AND t.deleted_at IS NULL
     AND o.status NOT IN ('sent', 'cancelled');
  WITH marked AS (
    UPDATE public.valo_tasks t SET needs_review = true, updated_at = now()
     WHERE t.rule_id = NEW.rule_id AND t.rule_version = NEW.version AND t.deleted_at IS NULL
       AND NOT t.needs_review
    RETURNING t.id, t.workspace_id, t.revision
  )
  INSERT INTO public.valo_events(id, workspace_id, actor_id, action, entity_id, revision)
  SELECT gen_random_uuid(), m.workspace_id, 'service:rule-change', 'task.source_review_required', m.id,
    m.revision
  FROM marked m;
  RETURN NULL;
END $$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.valo_note_rule_change() FROM PUBLIC;--> statement-breakpoint
CREATE TRIGGER valo_note_rule_change AFTER UPDATE OF status ON public.valo_rule_releases
FOR EACH ROW EXECUTE FUNCTION public.valo_note_rule_change();--> statement-breakpoint
-- A workspace reads its notices and marks them read, and changes nothing else of them.
GRANT SELECT, UPDATE(read_at) ON public.valo_rule_notices TO valo_workspace_scope;
