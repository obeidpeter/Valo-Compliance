-- PAY-001 (docs/architecture/order-safety.md, slice 2): an order is made from the price book.
--
-- The application reads an order's amount, its currency and its line from the price or the bundle's
-- version it buys, inside the transaction that makes the order. Until now nothing in the database
-- checked that it had: the application's login, and the role a customer's request acts as, may both
-- insert a row of valo_orders with any amount and any line.
--
-- This trigger refuses a new order unless the price, or the bundle's version, that it names is in
-- effect as the order is made, and the order's amount, its currency and its whole line are that
-- offer's. A bundle's line names the released edition of each of its templates, in any order.
--
-- The price book's own checks already refuse a price or a bundle's version without an approval
-- reference. Whether a product may be sold at all (released, not held, not overdue for its review)
-- stays with the application, which checks it under the edition's lock.
--
-- It runs with the rights of whoever inserts the order. Both roles that may insert one may already read
-- the price book and call valo_bundle_editions. It gives nobody a privilege.
--
-- Rows already in the table are not looked at. valo_orders_keep_terms (slice 1) keeps an order's terms
-- afterwards. A restored backup loads its rows before any trigger exists, so it puts back what there
-- was, unchecked.
CREATE FUNCTION public.valo_order_made_from_price_book() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $$
DECLARE price public.valo_prices%ROWTYPE;
DECLARE bundle public.valo_bundles%ROWTYPE;
DECLARE editions jsonb;
DECLARE unreleased boolean;
DECLARE moment timestamptz := clock_timestamp();
BEGIN
  IF jsonb_typeof(NEW.line) IS DISTINCT FROM 'object' THEN
    RAISE EXCEPTION 'An order is made with the amount and the line its offer gives' USING ERRCODE = '23514';
  END IF;
  IF NEW.price_id IS NOT NULL AND NEW.bundle_id IS NULL THEN
    SELECT * INTO price FROM public.valo_prices p WHERE p.id = NEW.price_id;
    IF NOT FOUND OR price.effective_from > moment
       OR (price.effective_to IS NOT NULL AND price.effective_to <= moment) THEN
      RAISE EXCEPTION 'An order is made from a price in effect' USING ERRCODE = '23514';
    END IF;
    IF NEW.amount_kobo IS DISTINCT FROM price.amount_kobo OR NEW.currency IS DISTINCT FROM price.currency
       OR NEW.line IS DISTINCT FROM jsonb_build_object(
            'title', price.title, 'contentVersionId', price.content_version_id::text,
            'licenceVersion', price.licence_version, 'licenceText', price.licence_text,
            'taxTreatment', price.tax_treatment) THEN
      RAISE EXCEPTION 'An order is made with the amount and the line its price gives'
        USING ERRCODE = '23514';
    END IF;
  ELSIF NEW.bundle_id IS NOT NULL AND NEW.price_id IS NULL THEN
    SELECT * INTO bundle FROM public.valo_bundles b WHERE b.id = NEW.bundle_id;
    IF NOT FOUND OR bundle.effective_from > moment
       OR (bundle.effective_to IS NOT NULL AND bundle.effective_to <= moment) THEN
      RAISE EXCEPTION 'An order is made from a bundle in effect' USING ERRCODE = '23514';
    END IF;
    -- The released edition of each of the bundle's templates. A template without one leaves the bundle
    -- nothing to sell.
    SELECT jsonb_agg(jsonb_build_object('contentVersionId', t.edition::text, 'title', t.title)),
           coalesce(bool_or(t.edition IS NULL), true)
      INTO editions, unreleased
      FROM public.valo_bundle_editions(NEW.bundle_id) t;
    IF unreleased THEN
      RAISE EXCEPTION 'An order is made from a bundle whose templates each have a released edition'
        USING ERRCODE = '23514';
    END IF;
    IF NEW.amount_kobo IS DISTINCT FROM bundle.amount_kobo OR NEW.currency IS DISTINCT FROM bundle.currency
       OR (NEW.line - 'editions') IS DISTINCT FROM jsonb_build_object(
            'title', bundle.title, 'bundle', bundle.bundle_key,
            'licenceVersion', bundle.licence_version, 'licenceText', bundle.licence_text,
            'taxTreatment', bundle.tax_treatment)
       OR jsonb_typeof(NEW.line->'editions') IS DISTINCT FROM 'array' THEN
      RAISE EXCEPTION 'An order is made with the amount and the line its bundle gives'
        USING ERRCODE = '23514';
    END IF;
    -- The same editions, each once, in any order.
    IF jsonb_array_length(NEW.line->'editions') <> jsonb_array_length(editions)
       OR NOT ((NEW.line->'editions') @> editions AND editions @> (NEW.line->'editions')) THEN
      RAISE EXCEPTION 'An order is made with the amount and the line its bundle gives'
        USING ERRCODE = '23514';
    END IF;
  END IF;
  -- An order that names neither offer, or both, is refused by the table's own check.
  RETURN NEW;
END;
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.valo_order_made_from_price_book() FROM PUBLIC;--> statement-breakpoint
CREATE TRIGGER valo_orders_made_from_price_book BEFORE INSERT ON public.valo_orders
  FOR EACH ROW EXECUTE FUNCTION public.valo_order_made_from_price_book();
