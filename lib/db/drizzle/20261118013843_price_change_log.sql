-- ADM-006: prices are versioned. A price's terms never change in place: a change of terms is
-- a new row with its own effective dates, and the only change to a row is closing it, once,
-- from the moment it is closed or later. Every insert, close and delete of a price is logged
-- in valo_price_changes, which is append-only; prices that already exist are logged as
-- 'existing'. A later migration that fills a new price column must disable
-- valo_prices_versioned for that statement. The table matches the Drizzle schema; the
-- functions, triggers and backfill are hand-written.
CREATE TABLE "valo_price_changes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"price_id" uuid NOT NULL,
	"action" text NOT NULL,
	"price" jsonb NOT NULL,
	"changed_by" text DEFAULT current_user NOT NULL,
	"changed_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "valo_price_changes_action_check" CHECK ("valo_price_changes"."action" IN ('existing', 'created', 'closed', 'deleted'))
);
--> statement-breakpoint
CREATE INDEX "valo_price_changes_price_idx" ON "valo_price_changes" USING btree ("price_id","changed_at");

--> statement-breakpoint
CREATE FUNCTION valo_price_versioned() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  -- Every column but effective_to, including any a later migration adds.
  IF (to_jsonb(NEW) - 'effective_to') IS DISTINCT FROM (to_jsonb(OLD) - 'effective_to') THEN
    RAISE EXCEPTION 'Price terms never change in place: a new price needs its own row' USING ERRCODE = '23514';
  END IF;
  IF NEW.effective_to IS DISTINCT FROM OLD.effective_to
    AND (OLD.effective_to IS NOT NULL OR NEW.effective_to IS NULL OR NEW.effective_to < now()) THEN
    RAISE EXCEPTION 'A price is closed once, from now or later' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER valo_prices_versioned BEFORE UPDATE ON valo_prices
  FOR EACH ROW EXECUTE FUNCTION valo_price_versioned();
--> statement-breakpoint
CREATE FUNCTION valo_price_change_log() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO valo_price_changes(price_id, action, price) VALUES (NEW.id, 'created', to_jsonb(NEW));
  ELSIF TG_OP = 'UPDATE' THEN
    IF NEW.effective_to IS DISTINCT FROM OLD.effective_to THEN
      INSERT INTO valo_price_changes(price_id, action, price) VALUES (NEW.id, 'closed', to_jsonb(NEW));
    END IF;
  ELSE
    INSERT INTO valo_price_changes(price_id, action, price) VALUES (OLD.id, 'deleted', to_jsonb(OLD));
  END IF;
  RETURN NULL;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER valo_prices_change_log AFTER INSERT OR UPDATE OR DELETE ON valo_prices
  FOR EACH ROW EXECUTE FUNCTION valo_price_change_log();
--> statement-breakpoint
CREATE FUNCTION valo_price_changes_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Price change history is append-only' USING ERRCODE = '23514';
END;
$$;
--> statement-breakpoint
CREATE TRIGGER valo_price_changes_append_only BEFORE UPDATE OR DELETE ON valo_price_changes
  FOR EACH ROW EXECUTE FUNCTION valo_price_changes_guard();
--> statement-breakpoint
CREATE TRIGGER valo_price_changes_no_truncate BEFORE TRUNCATE ON valo_price_changes
  FOR EACH STATEMENT EXECUTE FUNCTION valo_audit_truncate_guard();
--> statement-breakpoint
INSERT INTO valo_price_changes(price_id, action, price, changed_by)
  SELECT p.id, 'existing', to_jsonb(p), 'migration:20261118013843_price_change_log' FROM valo_prices p;
