import { pgTable, uuid, text, integer, timestamp, jsonb, uniqueIndex, index, foreignKey } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { valoWorkspaces } from "./valo-workspaces";
import { valoContentVersions } from "./valo-publication";

/** No seed price book: customer-facing prices require explicit commercial approval. */
export const valoPrices=pgTable("valo_prices",{
  id:uuid("id").primaryKey(),contentVersionId:uuid("content_version_id").notNull().references(()=>valoContentVersions.id),
  title:text("title").notNull(),amountKobo:integer("amount_kobo").notNull(),currency:text("currency").notNull().default("NGN"),
  licenceVersion:text("licence_version").notNull(),licenceText:text("licence_text").notNull(),
  taxTreatment:text("tax_treatment").notNull(),approvalReference:text("approval_reference").notNull(),
  effectiveFrom:timestamp("effective_from",{withTimezone:true}).notNull(),
  effectiveTo:timestamp("effective_to",{withTimezone:true}),createdAt:timestamp("created_at",{withTimezone:true}).notNull().defaultNow(),
});
export const valoOrders=pgTable("valo_orders",{
  id:uuid("id").primaryKey(),workspaceId:uuid("workspace_id").notNull().references(()=>valoWorkspaces.id),
  requestedBy:text("requested_by").notNull(),reference:text("reference").notNull(),
  requestKey:uuid("request_key").notNull(),priceId:uuid("price_id").notNull().references(()=>valoPrices.id),
  line:jsonb("line").$type<{title:string;contentVersionId:string;licenceVersion:string;licenceText:string;taxTreatment:string}>().notNull(),
  amountKobo:integer("amount_kobo").notNull(),currency:text("currency").notNull().default("NGN"),
  status:text("status").notNull().default("created"),providerTransactionId:text("provider_transaction_id"),
  checkoutUrl:text("checkout_url"),lastCheckedAt:timestamp("last_checked_at",{withTimezone:true}),
  createdAt:timestamp("created_at",{withTimezone:true}).notNull().defaultNow(),
},t=>[uniqueIndex("valo_order_reference_unique").on(t.reference),
  uniqueIndex("valo_order_workspace_key_unique").on(t.workspaceId,t.requestKey),
  uniqueIndex("valo_order_tenant_id_unique").on(t.workspaceId,t.id),
  uniqueIndex("valo_order_provider_transaction_unique").on(t.providerTransactionId),
  index("valo_orders_workspace_created_idx").on(t.workspaceId,t.createdAt)]);
export const valoPaymentEvents=pgTable("valo_payment_events",{
  id:uuid("id").primaryKey(),eventKey:text("event_key").notNull(),bodyHash:text("body_hash").notNull(),
  eventType:text("event_type").notNull(),reference:text("reference"),status:text("status").notNull().default("pending"),
  attempts:integer("attempts").notNull().default(0),failure:text("failure"),
  createdAt:timestamp("created_at",{withTimezone:true}).notNull().defaultNow(),
},t=>[uniqueIndex("valo_payment_event_key_unique").on(t.eventKey),index("valo_payment_event_status_idx").on(t.status)]);
export const valoEntitlements=pgTable("valo_entitlements",{
  id:uuid("id").primaryKey(),workspaceId:uuid("workspace_id").notNull().references(()=>valoWorkspaces.id),
  orderId:uuid("order_id").notNull(),contentVersionId:uuid("content_version_id").notNull().references(()=>valoContentVersions.id),
  status:text("status").notNull().default("active"),createdAt:timestamp("created_at",{withTimezone:true}).notNull().defaultNow(),
},t=>[uniqueIndex("valo_entitlement_order_unique").on(t.orderId),
  index("valo_entitlement_workspace_idx").on(t.workspaceId,t.contentVersionId),
  foreignKey({name:"valo_entitlement_order_tenant_fk",columns:[t.workspaceId,t.orderId],foreignColumns:[valoOrders.workspaceId,valoOrders.id]})]);
export const valoPurchaseOutbox=pgTable("valo_purchase_outbox",{
  id:uuid("id").primaryKey(),workspaceId:uuid("workspace_id").notNull().references(()=>valoWorkspaces.id),
  orderId:uuid("order_id").notNull(),kind:text("kind").notNull().default("purchase_receipt"),
  status:text("status").notNull().default("awaiting_email_configuration"),
  createdAt:timestamp("created_at",{withTimezone:true}).notNull().defaultNow(),
},t=>[uniqueIndex("valo_purchase_outbox_once").on(t.orderId,t.kind),
  foreignKey({name:"valo_purchase_outbox_order_tenant_fk",columns:[t.workspaceId,t.orderId],foreignColumns:[valoOrders.workspaceId,valoOrders.id]})]);
export const valoRefundRequests=pgTable("valo_refund_requests",{
  id:uuid("id").primaryKey(),workspaceId:uuid("workspace_id").notNull().references(()=>valoWorkspaces.id),
  orderId:uuid("order_id").notNull(),reason:text("reason").notNull(),status:text("status").notNull().default("requested"),
  createdAt:timestamp("created_at",{withTimezone:true}).notNull().defaultNow(),
},t=>[uniqueIndex("valo_refund_request_order_unique").on(t.orderId),
  foreignKey({name:"valo_refund_order_tenant_fk",columns:[t.workspaceId,t.orderId],foreignColumns:[valoOrders.workspaceId,valoOrders.id]})]);
export const insertValoOrderSchema=createInsertSchema(valoOrders);
export const valoPaymentReconciliations=pgTable("valo_payment_reconciliations",{
  id:uuid("id").primaryKey(),workspaceId:uuid("workspace_id").notNull().references(()=>valoWorkspaces.id),
  orderId:uuid("order_id").notNull(),day:text("day").notNull(),status:text("status").notNull().default("pending"),
  attempts:integer("attempts").notNull().default(0),finding:text("finding"),
  createdAt:timestamp("created_at",{withTimezone:true}).notNull().defaultNow(),
},t=>[uniqueIndex("valo_reconciliation_order_day_unique").on(t.orderId,t.day),
  foreignKey({name:"valo_reconciliation_order_tenant_fk",columns:[t.workspaceId,t.orderId],foreignColumns:[valoOrders.workspaceId,valoOrders.id]})]);
