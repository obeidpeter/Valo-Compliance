import { check, index, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { workspaceRowPolicy } from "./valo-workspace-scope";
import { valoWorkspaces } from "./valo-workspaces";

/** What an email provider can report about a message it took, as Valo records it. */
const DELIVERIES = sql`('delivered', 'delayed', 'bounced', 'complained', 'undelivered')`;

/**
 * What the email provider reported about a message it took (docs/architecture/messages.md, part 3). The
 * webhook writes one row for each signed report before it answers, and the worker's messages job then
 * records the report on the message or reminder that holds the provider's reference.
 *
 * A row keeps the least it can:
 * - `provider` and `event_key`: the provider, and its own id for this report. A report delivered twice is
 *   one row.
 * - `delivery` and `detail`: what was reported, and the kind of a bounce or failure.
 * - `provider_message_id`: the provider's reference for the message.
 * - `occurred_at`: the provider's time for the report.
 * - `status`: `pending` until the job finds the record; `applied` once it has; `unmatched` when no record
 *   held the reference within the time the job waits.
 * - `address_hash` and `address_key_version`: only for a report that suppresses, which is a bounce the
 *   provider calls permanent or a complaint: a keyed checksum of the one address the message went to, and
 *   the version of the key it was made under.
 *
 * It keeps no address, subject or text, and no workspace: the record the report is about says whose it is.
 * Customer requests have no access to it. A settled row is removed after thirty days.
 */
export const valoEmailEvents = pgTable(
  "valo_email_events",
  {
    id: uuid("id").primaryKey(),
    provider: text("provider").notNull(),
    eventKey: text("event_key").notNull(),
    delivery: text("delivery").notNull(),
    detail: text("detail"),
    providerMessageId: text("provider_message_id").notNull(),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),
    status: text("status").notNull().default("pending"),
    receivedAt: timestamp("received_at", { withTimezone: true }).notNull().defaultNow(),
    settledAt: timestamp("settled_at", { withTimezone: true }),
    addressHash: text("address_hash"),
    addressKeyVersion: text("address_key_version"),
  },
  (t) => [
    uniqueIndex("valo_email_event_once").on(t.provider, t.eventKey),
    index("valo_email_event_status_idx").on(t.status, t.receivedAt),
    check(
      "valo_email_event_shape",
      sql`${t.provider} ~ '^[a-z][a-z0-9-]{1,39}$'
        AND length(${t.eventKey}) BETWEEN 1 AND 200
        AND ${t.delivery} IN ${DELIVERIES}
        AND (${t.detail} IS NULL OR ${t.detail} ~ '^[A-Z][A-Z0-9_]{2,63}$')
        AND length(${t.providerMessageId}) BETWEEN 1 AND 200
        AND ${t.status} IN ('pending', 'applied', 'unmatched')
        AND (${t.status} = 'pending') = (${t.settledAt} IS NULL)`,
    ),
    check(
      "valo_email_event_address",
      sql`(${t.addressHash} IS NULL) = (${t.addressKeyVersion} IS NULL)
        AND (${t.addressHash} IS NULL OR (${t.addressHash} ~ '^[a-f0-9]{64}$'
          AND ${t.addressKeyVersion} ~ '^[a-zA-Z0-9_-]{1,80}$'
          AND ${t.delivery} IN ('bounced', 'complained')))`,
    ),
  ],
);
export type ValoEmailEvent = typeof valoEmailEvents.$inferSelect;

/**
 * The addresses Valo has stopped sending optional messages to (docs/architecture/messages.md, part 3):
 * one row for each address whose email service sent a message back for good, or reported it as spam.
 *
 * - `address_hash` and `key_version`: a keyed checksum of the address, and the version of the key it was
 *   made under, so that a later key still finds it. Never the address: a row cannot be read back into one.
 * - `reason`: `bounced` or `complained`, as last reported.
 * - `expires_at`: 180 days after the last report. An address is tried again after that, and suppressed
 *   again if its email service says the same.
 *
 * It names no person and no workspace. Customer requests have no access to it: the one question they
 * need answered, whether an address is suppressed, they ask through `valo_email_address_suppressed`, which
 * returns only yes or no for a checksum the caller already holds.
 */
export const valoEmailSuppressions = pgTable(
  "valo_email_suppressions",
  {
    id: uuid("id").primaryKey(),
    keyVersion: text("key_version").notNull(),
    addressHash: text("address_hash").notNull(),
    reason: text("reason").notNull(),
    firstReportedAt: timestamp("first_reported_at", { withTimezone: true }).notNull(),
    lastReportedAt: timestamp("last_reported_at", { withTimezone: true }).notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  },
  (t) => [
    uniqueIndex("valo_email_suppression_once").on(t.keyVersion, t.addressHash),
    index("valo_email_suppression_expiry_idx").on(t.expiresAt),
    check(
      "valo_email_suppression_shape",
      sql`${t.reason} IN ('bounced', 'complained')
        AND ${t.addressHash} ~ '^[a-f0-9]{64}$'
        AND ${t.keyVersion} ~ '^[a-zA-Z0-9_-]{1,80}$'
        AND ${t.lastReportedAt} >= ${t.firstReportedAt}
        AND ${t.expiresAt} > ${t.lastReportedAt}`,
    ),
  ],
);
export type ValoEmailSuppression = typeof valoEmailSuppressions.$inferSelect;

/**
 * The latest thing the email provider reported about one message or reminder of a workspace (part 3):
 * that the address's email service took it, that it is delayed, that it came back, that it was marked as
 * spam, or that the provider could not send it.
 *
 * - `source` and `record_id`: the record it is about, a row of `valo_messages` or of
 *   `valo_reminder_outbox`. A record has one row here at most.
 * - `delivery`, `detail` and `reported_at`: the report, and the provider's time for it. A later report
 *   replaces an earlier one only if it says more: delayed, then delivered, then undelivered, then
 *   bounced, then complained.
 *
 * A message with no row here has no report: it was taken by a sender, and that is all Valo knows. The
 * worker's messages job writes these rows in the record's workspace scope; customer requests read them.
 */
export const valoMessageDeliveries = pgTable(
  "valo_message_deliveries",
  {
    id: uuid("id").primaryKey(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => valoWorkspaces.id),
    source: text("source").notNull(),
    recordId: uuid("record_id").notNull(),
    delivery: text("delivery").notNull(),
    detail: text("detail"),
    reportedAt: timestamp("reported_at", { withTimezone: true }).notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("valo_message_delivery_once").on(t.workspaceId, t.source, t.recordId),
    check(
      "valo_message_delivery_shape",
      sql`${t.source} IN ('message', 'reminder')
        AND ${t.delivery} IN ${DELIVERIES}
        AND (${t.detail} IS NULL OR ${t.detail} ~ '^[A-Z][A-Z0-9_]{2,63}$')`,
    ),
    workspaceRowPolicy(t.workspaceId),
  ],
);
export type ValoMessageDelivery = typeof valoMessageDeliveries.$inferSelect;
