-- ADM-009 (docs/architecture/audit-trail.md): each write to a history added its change to one of the
-- history's sixteen digest rows, and held that row until its transaction ended. Two transactions that
-- each wrote rows in more than one shard, taking them in the order their rows came, could each hold a row
-- the other then waited for, and the database ended one of them as a deadlock; an update alone takes two
-- shards, the old row's and the new one's. Now each write adds its change as a row of its own, which no
-- other writer waits on, and a history's digest is its rows in valo_history_digests and its changes in
-- valo_history_digest_changes together. Removing changes folds them into valo_history_digests, so the
-- digest stays the same, and the hourly count removes them all before it counts.
REVOKE ALL ON public.valo_history_digest_changes FROM PUBLIC;--> statement-breakpoint
REVOKE ALL ON SEQUENCE public.valo_history_digest_changes_id_seq FROM PUBLIC;--> statement-breakpoint

-- After each write to a history, its digest takes away the old row's hash and adds the new row's, in the
-- same transaction, as changes of their own. It runs as its owner, so a customer request's write keeps the
-- digest true without the customer role holding any privilege on it.
CREATE OR REPLACE FUNCTION public.valo_history_digest_maintain() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp SET timezone = 'UTC' SET extra_float_digits = 1 AS $$
DECLARE
  h bigint;
BEGIN
  IF TG_OP IN ('UPDATE', 'DELETE') THEN
    h := public.valo_history_row_hash(to_jsonb(OLD));
    INSERT INTO public.valo_history_digest_changes (table_name, shard, row_count, hash_sum)
      VALUES (TG_TABLE_NAME, abs(h % 16), -1, -h);
  END IF;
  IF TG_OP IN ('INSERT', 'UPDATE') THEN
    h := public.valo_history_row_hash(to_jsonb(NEW));
    INSERT INTO public.valo_history_digest_changes (table_name, shard, row_count, hash_sum)
      VALUES (TG_TABLE_NAME, abs(h % 16), 1, h);
  END IF;
  RETURN NULL;
END;
$$;--> statement-breakpoint

-- Only a history's own trigger adds a change, and no change is altered. These triggers fire for each
-- statement or on insert only, so the changes are not themselves a history: removing one folds it in.
CREATE FUNCTION public.valo_history_digest_change_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP <> 'INSERT' OR pg_trigger_depth() < 2 THEN
    RAISE EXCEPTION 'A history digest changes only as its history does' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.valo_history_digest_change_guard() FROM PUBLIC;--> statement-breakpoint
CREATE TRIGGER valo_history_digest_changes_added_only BEFORE INSERT ON public.valo_history_digest_changes
  FOR EACH ROW EXECUTE FUNCTION public.valo_history_digest_change_guard();--> statement-breakpoint
CREATE TRIGGER valo_history_digest_changes_never_altered BEFORE UPDATE ON public.valo_history_digest_changes
  FOR EACH STATEMENT EXECUTE FUNCTION public.valo_history_digest_change_guard();--> statement-breakpoint
CREATE TRIGGER valo_history_digest_changes_no_truncate BEFORE TRUNCATE ON public.valo_history_digest_changes
  FOR EACH STATEMENT EXECUTE FUNCTION public.valo_audit_truncate_guard();--> statement-breakpoint

-- Changes removed are folded into the digest's rows, in the same statement, so removing them leaves the
-- digest as it was. The digest's rows are taken in one order, so two folds never wait on each other in a
-- circle; the digest's own guard lets this trigger change them, as it let the history's trigger before.
CREATE FUNCTION public.valo_history_digest_fold() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO public.valo_history_digests AS d (table_name, shard, row_count, hash_sum)
    SELECT f.table_name, f.shard, sum(f.row_count), sum(f.hash_sum) FROM folded f
    GROUP BY f.table_name, f.shard ORDER BY f.table_name, f.shard
    ON CONFLICT (table_name, shard) DO UPDATE
      SET row_count = d.row_count + EXCLUDED.row_count, hash_sum = d.hash_sum + EXCLUDED.hash_sum;
  RETURN NULL;
END;
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.valo_history_digest_fold() FROM PUBLIC;--> statement-breakpoint
CREATE TRIGGER valo_history_digest_changes_fold AFTER DELETE ON public.valo_history_digest_changes
  REFERENCING OLD TABLE AS folded FOR EACH STATEMENT EXECUTE FUNCTION public.valo_history_digest_fold();--> statement-breakpoint

-- The histories whose digest no longer matches their rows, and those whose digest trigger is missing or
-- disabled. A history's digest is its rows and its changes together. The caller counts in one snapshot
-- (REPEATABLE READ), so a write in flight, or a fold, is in both or neither.
CREATE OR REPLACE FUNCTION public.valo_history_digest_mismatches() RETURNS SETOF text LANGUAGE plpgsql STABLE AS $$
DECLARE
  history regclass;
  name text;
BEGIN
  FOR history, name IN
    SELECT c.oid::regclass, c.relname FROM pg_class c
    WHERE c.relnamespace = 'public'::regnamespace
      AND c.relname NOT IN ('valo_history_digests', 'valo_history_checks')
      AND EXISTS (SELECT FROM pg_trigger t WHERE t.tgrelid = c.oid AND NOT t.tgisinternal
        AND (t.tgtype & 1) = 1 AND (t.tgtype & 8) <> 0)
    ORDER BY c.relname
  LOOP
    IF NOT EXISTS (SELECT FROM pg_trigger t WHERE t.tgrelid = history
        AND t.tgfoid = 'public.valo_history_digest_maintain'::regproc AND t.tgenabled <> 'D')
      OR EXISTS (
        SELECT FROM public.valo_history_digest_counts(history) c
        FULL JOIN (
          SELECT k.shard, sum(k.row_count) AS row_count, sum(k.hash_sum) AS hash_sum FROM (
            SELECT b.shard, b.row_count, b.hash_sum FROM public.valo_history_digests b WHERE b.table_name = name
            UNION ALL
            SELECT g.shard, g.row_count, g.hash_sum FROM public.valo_history_digest_changes g WHERE g.table_name = name
          ) k GROUP BY k.shard) d
          USING (shard)
        WHERE COALESCE(c.row_count, 0) <> COALESCE(d.row_count, 0) OR COALESCE(c.hash_sum, 0) <> COALESCE(d.hash_sum, 0))
    THEN
      RETURN NEXT name;
    END IF;
  END LOOP;
END;
$$;--> statement-breakpoint

-- A migration that changes a history's columns starts its digest again from the rows it holds
-- (20261126001058). The history's changes are removed first, which folds them in, and its digest's rows
-- are then replaced, so no change counted before the migration is counted again.
CREATE OR REPLACE FUNCTION public.valo_history_digest_reseed(history regclass) RETURNS void
LANGUAGE plpgsql SET search_path = public, pg_temp SET timezone = 'UTC' SET extra_float_digits = 1 AS $$
DECLARE
  name text;
BEGIN
  SELECT c.relname INTO name FROM pg_class c
  WHERE c.oid = history AND c.relnamespace = 'public'::regnamespace
    AND EXISTS (SELECT FROM pg_trigger t WHERE t.tgrelid = c.oid
      AND t.tgfoid = 'public.valo_history_digest_maintain'::regproc);
  IF name IS NULL THEN
    RAISE EXCEPTION 'Only a history that keeps a digest is reseeded' USING ERRCODE = '22023';
  END IF;
  DELETE FROM public.valo_history_digest_changes WHERE table_name = name;
  -- The digest's own guard lets only a trigger change it. This is the one other change, made in the
  -- migration's transaction, and the guard is on again before the function returns.
  ALTER TABLE public.valo_history_digests DISABLE TRIGGER valo_history_digests_maintained_only;
  DELETE FROM public.valo_history_digests WHERE table_name = name;
  INSERT INTO public.valo_history_digests (table_name, shard, row_count, hash_sum)
    SELECT name, d.shard, d.row_count, d.hash_sum FROM public.valo_history_digest_counts(history) d;
  ALTER TABLE public.valo_history_digests ENABLE TRIGGER valo_history_digests_maintained_only;
END;
$$;
