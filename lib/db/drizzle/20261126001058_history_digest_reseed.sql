-- ADM-009 (docs/architecture/audit-trail.md): a row's hash is the hash of every column it holds, so a
-- migration that adds, drops, renames or retypes a history's column changes the hash of every row it
-- already holds, and the hourly count would find that history no longer matching its digest. Such a
-- migration calls this function for that history, in its own transaction, after the change: the
-- history's digest starts again from the rows it holds then, as each digest started when it was made
-- (20261125230122). Only a migration calls it; the repository rule history-reseed keeps product code
-- from naming it, so the application cannot rewrite a digest to hide a change to its history.
CREATE FUNCTION public.valo_history_digest_reseed(history regclass) RETURNS void
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
  -- The digest's own guard lets only a history's trigger change it. This is the one other change, made
  -- in the migration's transaction, and the guard is on again before the function returns.
  ALTER TABLE public.valo_history_digests DISABLE TRIGGER valo_history_digests_maintained_only;
  DELETE FROM public.valo_history_digests WHERE table_name = name;
  INSERT INTO public.valo_history_digests (table_name, shard, row_count, hash_sum)
    SELECT name, d.shard, d.row_count, d.hash_sum FROM public.valo_history_digest_counts(history) d;
  ALTER TABLE public.valo_history_digests ENABLE TRIGGER valo_history_digests_maintained_only;
END;
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.valo_history_digest_reseed(regclass) FROM PUBLIC;
