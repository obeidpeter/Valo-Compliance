-- ADM-009 (docs/architecture/audit-trail.md): the database keeps a digest of every history as it is
-- written, so a change made with the triggers off, or in replica mode, leaves the digest behind and the
-- hourly count finds it. A history is every table whose rows a trigger guards against deletion, the rule
-- the TRUNCATE guards follow (20261125221351).
REVOKE ALL ON public.valo_history_digests, public.valo_history_checks FROM PUBLIC;--> statement-breakpoint

-- A row's hash: the first 64 bits of the SHA-256 of its JSON form. The callers read the row in UTC, so a
-- session's time zone cannot change it.
CREATE FUNCTION public.valo_history_row_hash(row_value jsonb) RETURNS bigint
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT ('x' || substr(encode(sha256(convert_to(row_value::text, 'UTF8')), 'hex'), 1, 16))::bit(64)::bigint
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.valo_history_row_hash(jsonb) FROM PUBLIC;--> statement-breakpoint

-- A history's rows counted now, by shard: how many, and the sum of their hashes.
CREATE FUNCTION public.valo_history_digest_counts(history regclass)
RETURNS TABLE (shard smallint, row_count bigint, hash_sum numeric)
LANGUAGE plpgsql STABLE SET timezone = 'UTC' SET extra_float_digits = 1 AS $$
BEGIN
  RETURN QUERY EXECUTE format(
    'SELECT abs(h %% 16)::smallint, count(*), sum(h) FROM (SELECT public.valo_history_row_hash(to_jsonb(t)) AS h FROM %s t) r GROUP BY 1',
    history);
END;
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.valo_history_digest_counts(regclass) FROM PUBLIC;--> statement-breakpoint

-- After each write to a history, its digest takes away the old row's hash and adds the new row's, in the
-- same transaction. It runs as its owner, so a customer request's write keeps the digest true without the
-- customer role holding any privilege on it.
CREATE FUNCTION public.valo_history_digest_maintain() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp SET timezone = 'UTC' SET extra_float_digits = 1 AS $$
DECLARE
  h bigint;
BEGIN
  IF TG_OP IN ('UPDATE', 'DELETE') THEN
    h := public.valo_history_row_hash(to_jsonb(OLD));
    INSERT INTO public.valo_history_digests AS d (table_name, shard, row_count, hash_sum)
      VALUES (TG_TABLE_NAME, abs(h % 16), -1, -h)
      ON CONFLICT (table_name, shard) DO UPDATE SET row_count = d.row_count - 1, hash_sum = d.hash_sum - h;
  END IF;
  IF TG_OP IN ('INSERT', 'UPDATE') THEN
    h := public.valo_history_row_hash(to_jsonb(NEW));
    INSERT INTO public.valo_history_digests AS d (table_name, shard, row_count, hash_sum)
      VALUES (TG_TABLE_NAME, abs(h % 16), 1, h)
      ON CONFLICT (table_name, shard) DO UPDATE SET row_count = d.row_count + 1, hash_sum = d.hash_sum + h;
  END IF;
  RETURN NULL;
END;
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.valo_history_digest_maintain() FROM PUBLIC;--> statement-breakpoint

-- Each history's digest starts from the rows it holds now, and from now on its trigger keeps it.
DO $$
DECLARE
  history regclass;
  name text;
BEGIN
  FOR history, name IN
    SELECT c.oid::regclass, c.relname FROM pg_class c
    WHERE c.relnamespace = 'public'::regnamespace AND EXISTS (
      SELECT FROM pg_trigger t WHERE t.tgrelid = c.oid AND NOT t.tgisinternal
        AND (t.tgtype & 1) = 1 AND (t.tgtype & 8) <> 0)
    ORDER BY c.relname
  LOOP
    INSERT INTO public.valo_history_digests (table_name, shard, row_count, hash_sum)
      SELECT name, d.shard, d.row_count, d.hash_sum FROM public.valo_history_digest_counts(history) d;
    EXECUTE format('CREATE TRIGGER %I AFTER INSERT OR UPDATE OR DELETE ON %s FOR EACH ROW EXECUTE FUNCTION public.valo_history_digest_maintain()',
      name || '_digest', history);
  END LOOP;
END;
$$;--> statement-breakpoint

-- Only a history's own trigger changes its digest: a direct change, a removal or TRUNCATE is refused.
CREATE FUNCTION public.valo_history_digest_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' OR pg_trigger_depth() < 2 THEN
    RAISE EXCEPTION 'A history digest changes only as its history does' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.valo_history_digest_guard() FROM PUBLIC;--> statement-breakpoint
CREATE TRIGGER valo_history_digests_maintained_only BEFORE INSERT OR UPDATE OR DELETE ON public.valo_history_digests
  FOR EACH ROW EXECUTE FUNCTION public.valo_history_digest_guard();--> statement-breakpoint
CREATE TRIGGER valo_history_digests_no_truncate BEFORE TRUNCATE ON public.valo_history_digests
  FOR EACH STATEMENT EXECUTE FUNCTION public.valo_audit_truncate_guard();--> statement-breakpoint

-- An hourly count is kept as it was found.
CREATE FUNCTION public.valo_history_check_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'A history count is never changed or removed' USING ERRCODE = '23514';
END;
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.valo_history_check_guard() FROM PUBLIC;--> statement-breakpoint
CREATE TRIGGER valo_history_checks_append_only BEFORE UPDATE OR DELETE ON public.valo_history_checks
  FOR EACH ROW EXECUTE FUNCTION public.valo_history_check_guard();--> statement-breakpoint
CREATE TRIGGER valo_history_checks_no_truncate BEFORE TRUNCATE ON public.valo_history_checks
  FOR EACH STATEMENT EXECUTE FUNCTION public.valo_audit_truncate_guard();--> statement-breakpoint

-- The histories whose digest no longer matches their rows, and those whose digest trigger is missing or
-- disabled. The caller counts in one snapshot (REPEATABLE READ), so a write in flight is in both or neither.
CREATE FUNCTION public.valo_history_digest_mismatches() RETURNS SETOF text LANGUAGE plpgsql STABLE AS $$
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
        FULL JOIN (SELECT d.shard, d.row_count, d.hash_sum FROM public.valo_history_digests d WHERE d.table_name = name) d
          USING (shard)
        WHERE COALESCE(c.row_count, 0) <> COALESCE(d.row_count, 0) OR COALESCE(c.hash_sum, 0) <> COALESCE(d.hash_sum, 0))
    THEN
      RETURN NEXT name;
    END IF;
  END LOOP;
END;
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.valo_history_digest_mismatches() FROM PUBLIC;
