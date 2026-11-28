import {
  pgTable,
  uuid,
  text,
  integer,
  timestamp,
  jsonb,
  boolean,
  uniqueIndex,
  unique,
  index,
  foreignKey,
  check,
  type AnyPgColumn,
} from "drizzle-orm/pg-core";
import { currentWorkspace, linkedRowPolicy, workspaceRowPolicy } from "./valo-workspace-scope";
import { sql } from "drizzle-orm";
import { createInsertSchema } from "drizzle-zod";
import { valoWorkspaces } from "./valo-workspaces";
import { valoContentVersions } from "./valo-publication";
import { valoManualLibrary } from "./valo-manual-library";

/** Prices and purchases name an immutable edition from either publisher. */
export const valoCommerceVersions = pgTable(
  "valo_commerce_versions",
  {
    id: uuid("id").primaryKey(),
    reviewedVersionId: uuid("reviewed_version_id").references(() => valoContentVersions.id, {
      onDelete: "cascade",
    }),
    manualVersionId: uuid("manual_version_id").references(() => valoManualLibrary.id, {
      onDelete: "cascade",
    }),
  },
  (t) => [
    check(
      "valo_commerce_exact_version",
      sql`num_nonnulls(${t.reviewedVersionId},${t.manualVersionId}) = 1 AND ${t.id} = coalesce(${t.reviewedVersionId},${t.manualVersionId})`,
    ),
  ],
);

/** No seed price book: customer-facing prices require explicit commercial approval. */
export const valoPrices = pgTable(
  "valo_prices",
  {
    id: uuid("id").primaryKey(),
    contentVersionId: uuid("content_version_id")
      .notNull()
      .references(() => valoCommerceVersions.id),
    title: text("title").notNull(),
    amountKobo: integer("amount_kobo").notNull(),
    currency: text("currency").notNull().default("NGN"),
    licenceVersion: text("licence_version").notNull(),
    licenceText: text("licence_text").notNull(),
    taxTreatment: text("tax_treatment").notNull(),
    approvalReference: text("approval_reference").notNull(),
    effectiveFrom: timestamp("effective_from", { withTimezone: true }).notNull(),
    effectiveTo: timestamp("effective_to", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    /**
     * Whether the owner's approval of these terms covers the template's later editions
     * (docs/architecture/commercial-settings.md, slice 2). Part of the terms: it never changes.
     */
    carriesToLaterEditions: boolean("carries_to_later_editions").notNull().default(false),
    /** The price this one was carried from, at the release of its template's next edition. */
    carriedFrom: uuid("carried_from").references((): AnyPgColumn => valoPrices.id),
  },
  (t) => [
    check("valo_prices_amount_kobo_check", sql`${t.amountKobo} > 0`),
    check("valo_prices_approval_reference_check", sql`length(${t.approvalReference}) > 0`),
    check("valo_prices_check", sql`${t.effectiveTo} IS NULL OR ${t.effectiveTo} > ${t.effectiveFrom}`),
    check("valo_prices_currency_check", sql`${t.currency} = 'NGN'`),
    // A price carried to a later edition carries on to the next.
    check("valo_prices_carried_check", sql`${t.carriedFrom} IS NULL OR ${t.carriesToLaterEditions}`),
  ],
);
/**
 * ADM-006: every change to a price row, written by the triggers on valo_prices (migration
 * price_change_log). A price's terms never change in place: a new price is a new row with its
 * own effective dates, and closing one sets its end once. Rows here are never updated or deleted.
 */
export const valoPriceChanges = pgTable(
  "valo_price_changes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    priceId: uuid("price_id").notNull(),
    action: text("action").notNull(),
    price: jsonb("price").notNull().$type<Record<string, unknown>>(),
    changedBy: text("changed_by")
      .notNull()
      .default(sql`current_user`),
    changedAt: timestamp("changed_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("valo_price_changes_price_idx").on(t.priceId, t.changedAt),
    check(
      "valo_price_changes_action_check",
      sql`${t.action} IN ('existing', 'created', 'closed', 'deleted')`,
    ),
  ],
);
/**
 * ADM-006 (docs/architecture/commercial-settings.md, slice 4b): a bundle's versions. A bundle is a named,
 * curated set of the staff library's premium templates, sold once at one price. Each version names its
 * bundle, its title, the templates it holds (two to ten, each by its library item, so a bundle outlives its
 * templates' editions) and the owner's amount, licence, tax treatment and approval reference, with
 * effective dates. There is no seed bundle: until the owner records one, none exists. A version never
 * changes in place: the next one closes it when it starts, once, and the change log keeps both (migration
 * bundle_guards). A version is never removed.
 */
export const valoBundles = pgTable(
  "valo_bundles",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** The bundle's name across its versions. */
    bundleKey: text("bundle_key").notNull(),
    title: text("title").notNull(),
    /** The staff library items it holds, each a premium template, in order of their IDs. */
    items: uuid("items").array().notNull(),
    amountKobo: integer("amount_kobo").notNull(),
    currency: text("currency").notNull().default("NGN"),
    licenceVersion: text("licence_version").notNull(),
    licenceText: text("licence_text").notNull(),
    taxTreatment: text("tax_treatment").notNull(),
    approvalReference: text("approval_reference").notNull(),
    effectiveFrom: timestamp("effective_from", { withTimezone: true }).notNull(),
    effectiveTo: timestamp("effective_to", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // At most one version of a bundle has no end: the one in effect, or the one scheduled last.
    uniqueIndex("valo_bundles_open_unique")
      .on(t.bundleKey)
      .where(sql`${t.effectiveTo} IS NULL`),
    check("valo_bundles_key_check", sql`${t.bundleKey} ~ '^[a-z0-9][a-z0-9-]{1,62}$'`),
    check("valo_bundles_title_check", sql`length(${t.title}) BETWEEN 3 AND 120`),
    // Each item once, and each a premium template of the staff library: the guards migration's trigger.
    check("valo_bundles_items_check", sql`cardinality(${t.items}) BETWEEN 2 AND 10`),
    check("valo_bundles_amount_kobo_check", sql`${t.amountKobo} > 0`),
    check("valo_bundles_currency_check", sql`${t.currency} = 'NGN'`),
    check("valo_bundles_approval_reference_check", sql`length(${t.approvalReference}) > 0`),
    check("valo_bundles_check", sql`${t.effectiveTo} IS NULL OR ${t.effectiveTo} > ${t.effectiveFrom}`),
  ],
);
/**
 * ADM-006: every insert and close of a bundle's version, written by the triggers on valo_bundles
 * (migration bundle_guards). Rows here are never updated or removed.
 */
export const valoBundleChanges = pgTable(
  "valo_bundle_changes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    bundleId: uuid("bundle_id").notNull(),
    action: text("action").notNull(),
    bundle: jsonb("bundle").notNull().$type<Record<string, unknown>>(),
    changedBy: text("changed_by")
      .notNull()
      .default(sql`current_user`),
    changedAt: timestamp("changed_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("valo_bundle_changes_bundle_idx").on(t.bundleId, t.changedAt),
    check("valo_bundle_changes_action_check", sql`${t.action} IN ('created', 'closed')`),
  ],
);
/**
 * What an order copies when it is made: one priced edition and its terms, or a bundle's terms and, for each
 * of its templates, the released edition it grants, with its title (docs/architecture/commercial-settings.md,
 * slice 4c). The order keeps them after any later price, bundle version or edition.
 */
export type ValoOrderLine =
  | {
      title: string;
      contentVersionId: string;
      licenceVersion: string;
      licenceText: string;
      taxTreatment: string;
      bundle?: undefined;
      editions?: undefined;
    }
  | {
      title: string;
      contentVersionId?: undefined;
      /** The bundle's name. */
      bundle: string;
      editions: { contentVersionId: string; title: string }[];
      licenceVersion: string;
      licenceText: string;
      taxTreatment: string;
    };
export const valoOrders = pgTable(
  "valo_orders",
  {
    id: uuid("id").primaryKey(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => valoWorkspaces.id),
    requestedBy: text("requested_by").notNull(),
    reference: text("reference").notNull(),
    requestKey: uuid("request_key").notNull(),
    /** The price this order buys, for one template's order. An order names a price or a bundle. */
    priceId: uuid("price_id").references(() => valoPrices.id),
    /**
     * The bundle's version this order buys, for a bundle's order (docs/architecture/commercial-settings.md,
     * slice 4c).
     */
    bundleId: uuid("bundle_id").references(() => valoBundles.id),
    line: jsonb("line").$type<ValoOrderLine>().notNull(),
    amountKobo: integer("amount_kobo").notNull(),
    currency: text("currency").notNull().default("NGN"),
    status: text("status").notNull().default("created"),
    providerTransactionId: text("provider_transaction_id"),
    checkoutUrl: text("checkout_url"),
    lastCheckedAt: timestamp("last_checked_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    /**
     * Whether this purchase carries to its template's later editions: the owner's access rule in effect
     * when the order was created, which the database records and keeps (docs/architecture/
     * commercial-settings.md, slice 3b). None on an order made before the rule had a record, which
     * carries, as every purchase did when it was made.
     */
    carriesToLaterEditions: boolean("carries_to_later_editions"),
  },
  (t) => [
    uniqueIndex("valo_order_reference_unique").on(t.reference),
    uniqueIndex("valo_order_workspace_key_unique").on(t.workspaceId, t.requestKey),
    uniqueIndex("valo_order_tenant_id_unique").on(t.workspaceId, t.id),
    uniqueIndex("valo_order_provider_transaction_unique").on(t.providerTransactionId),
    index("valo_orders_workspace_created_idx").on(t.workspaceId, t.createdAt),
    check("valo_orders_amount_kobo_check", sql`${t.amountKobo} > 0`),
    check("valo_orders_offer_check", sql`num_nonnulls(${t.priceId}, ${t.bundleId}) = 1`),
    check("valo_orders_currency_check", sql`${t.currency} = 'NGN'`),
    check(
      "valo_orders_status_check",
      sql`${t.status} IN ('created', 'pending', 'abandoned', 'failed', 'verified_success', 'needs_review', 'reversed')`,
    ),
    workspaceRowPolicy(t.workspaceId),
  ],
);
export const valoPaymentEvents = pgTable(
  "valo_payment_events",
  {
    id: uuid("id").primaryKey(),
    eventKey: text("event_key").notNull(),
    bodyHash: text("body_hash").notNull(),
    eventType: text("event_type").notNull(),
    reference: text("reference"),
    status: text("status").notNull().default("pending"),
    attempts: integer("attempts").notNull().default(0),
    failure: text("failure"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("valo_payment_event_key_unique").on(t.eventKey),
    index("valo_payment_event_status_idx").on(t.status),
    check("valo_payment_events_attempts_check", sql`${t.attempts} BETWEEN 0 AND 5`),
    check(
      "valo_payment_events_status_check",
      sql`${t.status} IN ('pending', 'processed', 'needs_review', 'ignored')`,
    ),
    // An event carries no workspace of its own: it belongs to the workspace whose order,
    // refund or dispute it references (ownedPaymentEvent in the API).
    linkedRowPolicy(
      sql`${t.reference} in (${sql.join(
        [
          sql`select reference from valo_orders where workspace_id = ${currentWorkspace}`,
          sql`select provider_transaction_id from valo_orders where workspace_id = ${currentWorkspace}`,
          sql`select reference from valo_refund_requests where workspace_id = ${currentWorkspace}`,
          sql`select provider_id from valo_refund_requests where workspace_id = ${currentWorkspace}`,
          sql`select provider_id from valo_payment_disputes where workspace_id = ${currentWorkspace}`,
        ],
        sql` union `,
      )})`,
    ),
  ],
);
/**
 * Finance's settlement of a provider event Valo could not match or process (docs/architecture/
 * reconciliation.md, slice 3a): one for each event and the finding it was settled with. Why is a row of the
 * staff access audit. The database's guard, `valo_payment_event_settlements_kept`, takes a settlement only
 * from finance with that row written in the same transaction, and never changes or removes one. A customer's
 * request has no access to it.
 */
export const valoPaymentEventSettlements = pgTable(
  "valo_payment_event_settlements",
  {
    id: uuid("id").primaryKey(),
    eventId: uuid("event_id").notNull(),
    finding: text("finding").notNull(),
    resolvedBy: text("resolved_by").notNull(),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("valo_payment_event_settlement_unique").on(t.eventId, t.finding),
    foreignKey({
      name: "valo_payment_event_settlement_event_fk",
      columns: [t.eventId],
      foreignColumns: [valoPaymentEvents.id],
    }),
  ],
);
/**
 * Each UTC day's reading of Paystack's own list of the successful payments it took
 * (docs/architecture/reconciliation.md, slice 3b). The worker reads a day's list once the day has ended. A
 * payment on it whose reference is no order's is recorded as a provider event that waits for finance, and
 * so is a list that could not be read, or not read whole. It names no workspace, and a customer's request
 * has no access to it.
 */
export const valoPaymentLists = pgTable(
  "valo_payment_lists",
  {
    day: text("day").primaryKey(),
    status: text("status").notNull().default("pending"),
    attempts: integer("attempts").notNull().default(0),
    lastAttemptAt: timestamp("last_attempt_at", { withTimezone: true }),
    pages: integer("pages"),
    transactions: integer("transactions"),
    unmatched: integer("unmatched"),
    finding: text("finding"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
  },
  (t) => [
    check("valo_payment_lists_day_check", sql`${t.day} ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'`),
    check("valo_payment_lists_status_check", sql`${t.status} IN ('pending', 'listed', 'needs_review')`),
    check("valo_payment_lists_attempts_check", sql`${t.attempts} BETWEEN 0 AND 3`),
  ],
);
export const valoEntitlements = pgTable(
  "valo_entitlements",
  {
    id: uuid("id").primaryKey(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => valoWorkspaces.id),
    orderId: uuid("order_id").notNull(),
    contentVersionId: uuid("content_version_id")
      .notNull()
      .references(() => valoCommerceVersions.id),
    status: text("status").notNull().default("active"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // One grant for each edition an order grants: a template's order grants one, a bundle's one for each of
    // its templates (slice 4c).
    uniqueIndex("valo_entitlement_order_edition_unique").on(t.orderId, t.contentVersionId),
    index("valo_entitlement_workspace_idx").on(t.workspaceId, t.contentVersionId),
    foreignKey({
      name: "valo_entitlement_order_tenant_fk",
      columns: [t.workspaceId, t.orderId],
      foreignColumns: [valoOrders.workspaceId, valoOrders.id],
    }),
    check("valo_entitlements_status_check", sql`${t.status} IN ('active', 'suspended')`),
    workspaceRowPolicy(t.workspaceId),
  ],
);
export const valoPurchaseOutbox = pgTable(
  "valo_purchase_outbox",
  {
    id: uuid("id").primaryKey(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => valoWorkspaces.id),
    orderId: uuid("order_id").notNull(),
    kind: text("kind").notNull().default("purchase_receipt"),
    status: text("status").notNull().default("awaiting_email_configuration"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("valo_purchase_outbox_once").on(t.orderId, t.kind),
    foreignKey({
      name: "valo_purchase_outbox_order_tenant_fk",
      columns: [t.workspaceId, t.orderId],
      foreignColumns: [valoOrders.workspaceId, valoOrders.id],
    }),
    workspaceRowPolicy(t.workspaceId),
  ],
);
export const valoRefundRequests = pgTable(
  "valo_refund_requests",
  {
    id: uuid("id").primaryKey(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => valoWorkspaces.id),
    orderId: uuid("order_id").notNull(),
    reason: text("reason").notNull(),
    status: text("status").notNull().default("requested"),
    amountKobo: integer("amount_kobo"),
    requestKey: uuid("request_key").notNull().defaultRandom(),
    reference: text("reference").notNull(),
    policyVersion: text("policy_version").notNull().default("legacy-unconfirmed"),
    version: integer("version").notNull().default(1),
    decisionReason: text("decision_reason"),
    authorisedBy: text("authorised_by"),
    authorisedAt: timestamp("authorised_at", { withTimezone: true }),
    providerId: text("provider_id"),
    attempts: integer("attempts").notNull().default(0),
    leaseToken: uuid("lease_token"),
    leaseUntil: timestamp("lease_until", { withTimezone: true }),
    nextAttemptAt: timestamp("next_attempt_at", { withTimezone: true }),
    checkedAt: timestamp("checked_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    failure: text("failure"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("valo_refund_request_key_unique").on(t.workspaceId, t.requestKey),
    uniqueIndex("valo_refund_reference_unique").on(t.reference),
    uniqueIndex("valo_refund_provider_unique").on(t.providerId),
    index("valo_refund_queue_idx").on(t.status, t.nextAttemptAt),
    index("valo_refund_workspace_order_idx").on(t.workspaceId, t.orderId, t.createdAt),
    foreignKey({
      name: "valo_refund_order_tenant_fk",
      columns: [t.workspaceId, t.orderId],
      foreignColumns: [valoOrders.workspaceId, valoOrders.id],
    }),
    check("valo_refund_requests_amount_kobo_check", sql`${t.amountKobo} > 0`),
    check("valo_refund_requests_attempts_check", sql`${t.attempts} BETWEEN 0 AND 5`),
    check(
      "valo_refund_requests_status_check",
      sql`${t.status} IN ('requested', 'authorised', 'provider_pending', 'approved', 'rejected', 'submitting', 'unknown', 'pending', 'processing', 'needs_attention', 'needs_review', 'failed', 'processed')`,
    ),
    check("valo_refund_requests_version_check", sql`${t.version} > 0`),
    workspaceRowPolicy(t.workspaceId),
  ],
);
export const valoRefundTransitions = pgTable(
  "valo_refund_transitions",
  {
    id: uuid("id").primaryKey(),
    workspaceId: uuid("workspace_id").notNull(),
    orderId: uuid("order_id").notNull(),
    refundId: uuid("refund_id")
      .notNull()
      .references(() => valoRefundRequests.id),
    actorId: text("actor_id").notNull(),
    action: text("action").notNull(),
    reason: text("reason").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    foreignKey({
      name: "valo_refund_audit_order_tenant_fk",
      columns: [t.workspaceId, t.orderId],
      foreignColumns: [valoOrders.workspaceId, valoOrders.id],
    }),
    workspaceRowPolicy(t.workspaceId),
  ],
);
export const valoPaymentDisputes = pgTable(
  "valo_payment_disputes",
  {
    id: uuid("id").primaryKey(),
    workspaceId: uuid("workspace_id").notNull(),
    orderId: uuid("order_id").notNull(),
    providerId: text("provider_id").notNull().unique(),
    status: text("status").notNull(),
    resolution: text("resolution"),
    held: boolean("held").notNull().default(false),
    controlVersion: integer("control_version").notNull().default(1),
    amountKobo: integer("amount_kobo"),
    checkedAt: timestamp("checked_at", { withTimezone: true }).notNull().defaultNow(),
    providerUpdatedAt: timestamp("provider_updated_at", { withTimezone: true }),
    snapshotHash: text("snapshot_hash"),
    category: text("category"),
  },
  (t) => [
    // Dispute information and actions reference a dispute with its workspace and
    // order, so a selected dispute cannot belong to another order.
    unique("valo_dispute_exact_binding").on(t.workspaceId, t.orderId, t.id),
    index("valo_dispute_workspace_order_idx").on(t.workspaceId, t.orderId, t.checkedAt),
    foreignKey({
      name: "valo_dispute_order_tenant_fk",
      columns: [t.workspaceId, t.orderId],
      foreignColumns: [valoOrders.workspaceId, valoOrders.id],
    }),
    check("valo_payment_disputes_amount_kobo_check", sql`${t.amountKobo} >= 0`),
    workspaceRowPolicy(t.workspaceId),
  ],
);
export const insertValoOrderSchema = createInsertSchema(valoOrders);
/** Financial evidence is structured text, never attachment bytes or signed URLs.
 * A customer statement is not a bank dispute or independent proof of delivery. */
export const valoDisputeInformation = pgTable(
  "valo_dispute_information",
  {
    id: uuid("id").primaryKey(),
    workspaceId: uuid("workspace_id").notNull(),
    orderId: uuid("order_id").notNull(),
    disputeId: uuid("dispute_id")
      .notNull()
      .references(() => valoPaymentDisputes.id),
    actorId: text("actor_id").notNull(),
    requestKey: uuid("request_key").notNull(),
    information: jsonb("information").$type<Record<string, string>>().notNull(),
    consentVersion: text("consent_version").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique("valo_dispute_information_request").on(t.workspaceId, t.requestKey),
    unique("valo_dispute_info_exact_binding").on(t.workspaceId, t.orderId, t.disputeId, t.id),
    foreignKey({
      name: "valo_dispute_information_order_fk",
      columns: [t.workspaceId, t.orderId],
      foreignColumns: [valoOrders.workspaceId, valoOrders.id],
    }),
    foreignKey({
      name: "valo_dispute_information_exact_dispute_fk",
      columns: [t.workspaceId, t.orderId, t.disputeId],
      foreignColumns: [valoPaymentDisputes.workspaceId, valoPaymentDisputes.orderId, valoPaymentDisputes.id],
    }),
    workspaceRowPolicy(t.workspaceId),
  ],
);
export const valoDisputeActions = pgTable(
  "valo_dispute_actions",
  {
    id: uuid("id").primaryKey(),
    workspaceId: uuid("workspace_id").notNull(),
    orderId: uuid("order_id").notNull(),
    disputeId: uuid("dispute_id")
      .notNull()
      .references(() => valoPaymentDisputes.id),
    requestKey: uuid("request_key").notNull(),
    kind: text("kind").notNull(),
    status: text("status").notNull().default("prepared"),
    version: integer("version").notNull().default(1),
    informationId: uuid("information_id").references(() => valoDisputeInformation.id),
    payload: jsonb("payload").$type<Record<string, string | number>>().notNull(),
    sourceHash: text("source_hash").notNull(),
    policyVersion: text("policy_version").notNull(),
    authorisedBy: text("authorised_by").notNull(),
    attempts: integer("attempts").notNull().default(0),
    claimToken: uuid("claim_token"),
    leaseUntil: timestamp("lease_until", { withTimezone: true }),
    result: jsonb("result").$type<Record<string, string>>(),
    failure: text("failure"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique("valo_dispute_action_request").on(t.disputeId, t.requestKey),
    // One live action of each kind per dispute; a cancelled one can be prepared again.
    uniqueIndex("valo_dispute_one_intent")
      .on(t.disputeId, t.kind)
      .where(sql`${t.status} <> 'cancelled'`),
    index("valo_dispute_action_order").on(t.workspaceId, t.orderId),
    foreignKey({
      name: "valo_dispute_action_order_fk",
      columns: [t.workspaceId, t.orderId],
      foreignColumns: [valoOrders.workspaceId, valoOrders.id],
    }),
    foreignKey({
      name: "valo_dispute_action_exact_dispute_fk",
      columns: [t.workspaceId, t.orderId, t.disputeId],
      foreignColumns: [valoPaymentDisputes.workspaceId, valoPaymentDisputes.orderId, valoPaymentDisputes.id],
    }),
    foreignKey({
      name: "valo_dispute_action_exact_information_fk",
      columns: [t.workspaceId, t.orderId, t.disputeId, t.informationId],
      foreignColumns: [
        valoDisputeInformation.workspaceId,
        valoDisputeInformation.orderId,
        valoDisputeInformation.disputeId,
        valoDisputeInformation.id,
      ],
    }),
    check("valo_dispute_actions_attempts_check", sql`${t.attempts} BETWEEN 0 AND 1`),
    check(
      "valo_dispute_actions_kind_check",
      sql`${t.kind} IN ('upload_receipt', 'submit_evidence', 'merchant_decision')`,
    ),
    check(
      "valo_dispute_actions_status_check",
      sql`${t.status} IN ('prepared', 'dispatching', 'acknowledged', 'observed', 'unknown', 'cancelled')`,
    ),
    workspaceRowPolicy(t.workspaceId),
  ],
);
export const insertValoDisputeActionSchema = createInsertSchema(valoDisputeActions);
export const valoDisputeTransitions = pgTable(
  "valo_dispute_transitions",
  {
    id: uuid("id").primaryKey(),
    workspaceId: uuid("workspace_id").notNull(),
    orderId: uuid("order_id").notNull(),
    actionId: uuid("action_id")
      .notNull()
      .references(() => valoDisputeActions.id),
    actorId: text("actor_id").notNull(),
    status: text("status").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    foreignKey({
      name: "valo_dispute_transition_order_fk",
      columns: [t.workspaceId, t.orderId],
      foreignColumns: [valoOrders.workspaceId, valoOrders.id],
    }),
    workspaceRowPolicy(t.workspaceId),
  ],
);
export const valoPaymentReconciliations = pgTable(
  "valo_payment_reconciliations",
  {
    id: uuid("id").primaryKey(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => valoWorkspaces.id),
    orderId: uuid("order_id").notNull(),
    day: text("day").notNull(),
    status: text("status").notNull().default("pending"),
    attempts: integer("attempts").notNull().default(0),
    // When the provider last gave no answer that could be used. A waiting row is not tried again within
    // the hour (docs/architecture/reconciliation.md, slice 1).
    lastAttemptAt: timestamp("last_attempt_at", { withTimezone: true }),
    finding: text("finding"),
    // Finance's settlement of a difference the check found (docs/architecture/reconciliation.md, slice 2):
    // what finance found, who settled it and when. Why is a row of the staff access audit.
    outcome: text("outcome"),
    resolvedBy: text("resolved_by"),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("valo_reconciliation_order_day_unique").on(t.orderId, t.day),
    foreignKey({
      name: "valo_reconciliation_order_tenant_fk",
      columns: [t.workspaceId, t.orderId],
      foreignColumns: [valoOrders.workspaceId, valoOrders.id],
    }),
    check("valo_payment_reconciliations_attempts_check", sql`${t.attempts} BETWEEN 0 AND 3`),
    check(
      "valo_payment_reconciliations_status_check",
      sql`${t.status} IN ('pending', 'matched', 'needs_review', 'resolved')`,
    ),
    check(
      "valo_payment_reconciliations_outcome_check",
      sql`${t.outcome} IS NULL OR ${t.outcome} IN ('explained', 'no_payment_stands')`,
    ),
    check(
      "valo_payment_reconciliations_resolution_check",
      sql`(${t.status} = 'resolved') = (${t.outcome} IS NOT NULL AND ${t.resolvedBy} IS NOT NULL AND ${t.resolvedAt} IS NOT NULL)`,
    ),
    workspaceRowPolicy(t.workspaceId),
  ],
);
