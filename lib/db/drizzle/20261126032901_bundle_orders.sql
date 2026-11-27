DROP INDEX "valo_entitlement_order_unique";--> statement-breakpoint
ALTER TABLE "valo_orders" ALTER COLUMN "price_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "valo_orders" ADD COLUMN "bundle_id" uuid;--> statement-breakpoint
ALTER TABLE "valo_orders" ADD CONSTRAINT "valo_orders_bundle_id_valo_bundles_id_fk" FOREIGN KEY ("bundle_id") REFERENCES "public"."valo_bundles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "valo_entitlement_order_edition_unique" ON "valo_entitlements" USING btree ("order_id","content_version_id");--> statement-breakpoint
ALTER TABLE "valo_orders" ADD CONSTRAINT "valo_orders_offer_check" CHECK (num_nonnulls("valo_orders"."price_id", "valo_orders"."bundle_id") = 1);