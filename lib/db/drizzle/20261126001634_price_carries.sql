-- ADM-006 (docs/architecture/commercial-settings.md, slice 2): a price records whether the owner's
-- approval of its terms covers the template's later editions, and a price carried to a later edition
-- names the price it came from. Both are part of the terms, which valo_price_versioned keeps as written.
ALTER TABLE "valo_prices" ADD COLUMN "carries_to_later_editions" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "valo_prices" ADD COLUMN "carried_from" uuid;--> statement-breakpoint
ALTER TABLE "valo_prices" ADD CONSTRAINT "valo_prices_carried_from_valo_prices_id_fk" FOREIGN KEY ("carried_from") REFERENCES "public"."valo_prices"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "valo_prices" ADD CONSTRAINT "valo_prices_carried_check" CHECK ("valo_prices"."carried_from" IS NULL OR "valo_prices"."carries_to_later_editions");--> statement-breakpoint
-- ADM-009: the new columns change the hash of every price row, so the prices' history digest starts again
-- from the rows they hold (20261126001058_history_digest_reseed).
SELECT public.valo_history_digest_reseed('public.valo_prices');
