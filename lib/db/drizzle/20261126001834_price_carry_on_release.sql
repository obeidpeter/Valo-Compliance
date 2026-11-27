-- ADM-006 (docs/architecture/commercial-settings.md, slice 2): when a premium template's next edition is
-- released in the staff library, each price of its earlier editions that carries to later editions, is
-- open now or starts later, and has not been carried already, is recorded for the new edition with the
-- same amount, licence, tax treatment and approval reference, carried from it: carried_from is the link,
-- so the owner's reference stays as it was written however many editions it is carried to. The earlier
-- price in effect closes at the release. A carried price carries on, so a later release carries its copy,
-- never the original again.
-- A price that does not carry is left as it is, and the new edition has no price until the owner records
-- one. The release runs it in its own transaction, whatever code releases the edition.
CREATE FUNCTION public.valo_carry_premium_prices() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE
  price public.valo_prices%ROWTYPE;
BEGIN
  FOR price IN
    SELECT p.* FROM public.valo_prices p
    JOIN public.valo_manual_library m ON m.id = p.content_version_id
    WHERE m.item_id = NEW.item_id AND m.id <> NEW.id
      AND p.carries_to_later_editions
      AND (p.effective_to IS NULL OR p.effective_to > now())
      AND NOT EXISTS (SELECT FROM public.valo_prices c WHERE c.carried_from = p.id)
    ORDER BY p.effective_from, p.id
    FOR UPDATE OF p
  LOOP
    INSERT INTO public.valo_prices (id, content_version_id, title, amount_kobo, currency, licence_version,
        licence_text, tax_treatment, approval_reference, effective_from, effective_to,
        carries_to_later_editions, carried_from)
      VALUES (gen_random_uuid(), NEW.id, NEW.title, price.amount_kobo, price.currency, price.licence_version,
        price.licence_text, price.tax_treatment, price.approval_reference,
        greatest(now(), price.effective_from), price.effective_to, true, price.id);
    IF price.effective_to IS NULL AND price.effective_from < now() THEN
      UPDATE public.valo_prices SET effective_to = now() WHERE id = price.id;
    END IF;
  END LOOP;
  RETURN NULL;
END;
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.valo_carry_premium_prices() FROM PUBLIC;--> statement-breakpoint
CREATE TRIGGER valo_manual_premium_release_carries_prices AFTER UPDATE OF state ON public.valo_manual_library
  FOR EACH ROW WHEN (NEW.state = 'published' AND OLD.state IS DISTINCT FROM 'published' AND NEW.kind = 'premium_template')
  EXECUTE FUNCTION public.valo_carry_premium_prices();
