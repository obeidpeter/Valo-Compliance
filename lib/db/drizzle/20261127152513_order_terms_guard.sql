-- PAY-001 (docs/architecture/order-safety.md, slice 1): an order keeps the terms it was made with.
--
-- An order's amount, its currency, its line and the price or bundle it buys are read from the price book
-- as the order is made. The application never changes them afterwards. Until now only its code kept
-- them: the application's login, and the role a customer's request acts as, may both update an order.
-- This trigger refuses any change to them, whoever asks.
--
-- It also keeps what says which order this is: its workspace, its reference, its request key and the
-- time it was made. Who placed it changes once, to the mark an erasure leaves in their place, and to
-- nothing else.
--
-- What happens to an order still changes: its status, the provider's transaction, its checkout address
-- and the time it was last checked. The trigger valo_orders_record_access_rule already keeps the access
-- rule an order was bought under.
CREATE FUNCTION public.valo_order_keeps_terms() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  IF ROW(NEW.id, NEW.workspace_id, NEW.reference, NEW.request_key, NEW.price_id, NEW.bundle_id,
         NEW.line, NEW.amount_kobo, NEW.currency, NEW.created_at)
     IS DISTINCT FROM
     ROW(OLD.id, OLD.workspace_id, OLD.reference, OLD.request_key, OLD.price_id, OLD.bundle_id,
         OLD.line, OLD.amount_kobo, OLD.currency, OLD.created_at) THEN
    RAISE EXCEPTION 'An order keeps the offer, the line and the amount it was made with'
      USING ERRCODE = '23514';
  END IF;
  IF NEW.requested_by IS DISTINCT FROM OLD.requested_by
     AND NEW.requested_by IS DISTINCT FROM 'privacy-erased' THEN
    RAISE EXCEPTION 'An order keeps who placed it, until an erasure removes them'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.valo_order_keeps_terms() FROM PUBLIC;--> statement-breakpoint
CREATE TRIGGER valo_orders_keep_terms BEFORE UPDATE ON public.valo_orders
  FOR EACH ROW EXECUTE FUNCTION public.valo_order_keeps_terms();
