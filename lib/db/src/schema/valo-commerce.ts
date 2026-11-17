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
} from "drizzle-orm/pg-core";
import { workspaceRowPolicy } from "./valo-workspace-scope";
import { sql } from "drizzle-orm";
import { createInsertSchema } from "drizzle-zod";
import { valoWorkspaces } from "./valo-workspaces";
import { valoContentVersions } from "./valo-publication";

/** No seed price book: customer-facing prices require explicit commercial approval. */
export const valoPrices = pgTable(
  "valo_prices",
  {
    id: uuid("id").primaryKey(),
    contentVersionId: uuid("content_version_id")
      .notNull()
      .references(() => valoContentVersions.id),
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
  },
  (t) => [
    check("valo_prices_amount_kobo_check", sql`${t.amountKobo} > 0`),
    check("valo_prices_approval_reference_check", sql`length(${t.approvalReference}) > 0`),
    check("valo_prices_check", sql`${t.effectiveTo} IS NULL OR ${t.effectiveTo} > ${t.effectiveFrom}`),
    check("valo_prices_currency_check", sql`${t.currency} = 'NGN'`),
  ],
);
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
    priceId: uuid("price_id")
      .notNull()
      .references(() => valoPrices.id),
    line: jsonb("line")
      .$type<{
        title: string;
        contentVersionId: string;
        licenceVersion: string;
        licenceText: string;
        taxTreatment: string;
      }>()
      .notNull(),
    amountKobo: integer("amount_kobo").notNull(),
    currency: text("currency").notNull().default("NGN"),
    status: text("status").notNull().default("created"),
    providerTransactionId: text("provider_transaction_id"),
    checkoutUrl: text("checkout_url"),
    lastCheckedAt: timestamp("last_checked_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("valo_order_reference_unique").on(t.reference),
    uniqueIndex("valo_order_workspace_key_unique").on(t.workspaceId, t.requestKey),
    uniqueIndex("valo_order_tenant_id_unique").on(t.workspaceId, t.id),
    uniqueIndex("valo_order_provider_transaction_unique").on(t.providerTransactionId),
    index("valo_orders_workspace_created_idx").on(t.workspaceId, t.createdAt),
    check("valo_orders_amount_kobo_check", sql`${t.amountKobo} > 0`),
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
      .references(() => valoContentVersions.id),
    status: text("status").notNull().default("active"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("valo_entitlement_order_unique").on(t.orderId),
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
    finding: text("finding"),
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
      sql`${t.status} IN ('pending', 'matched', 'needs_review')`,
    ),
    workspaceRowPolicy(t.workspaceId),
  ],
);
