import { check, index, integer, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { workspaceRowPolicy } from "./valo-workspace-scope";
import { valoWorkspaces } from "./valo-workspaces";

/**
 * Each message Valo means to send (docs/architecture/messages.md, part 1). The event that owes a message
 * writes its row in its own transaction: a settled order owes its receipt, a refund the provider confirmed
 * owes its notice. A row keeps no message text: the dispatcher composes it from the record it is about as it
 * sends it, and reads the recipient's verified address then.
 *
 * - `kind` and `class`: what the message is, and whether it is necessary or optional. Every kind there
 *   is yet is necessary.
 * - `recipient_identity_id`: whose verified address the message goes to.
 * - `subject_id`: the record it is about: the order for a receipt, the refund for a refund notice, the
 *   day's row in `valo_notice_digests` for a day's notices. A workspace's record owes one message of each
 *   kind. The rule is each workspace's own, so no row in one workspace can stand in the way of another's.
 * - `status`: `queued`, then `sending` while one attempt holds its lease, then `accepted` once a sender took
 *   it. `held` waits for something that stops it now, such as the pause; `failed` and `cancelled` end it.
 *   An accepted message is never called delivered: nothing here records a delivery.
 *
 * Customer requests add a message their action owes and read their own workspace's. The dispatcher, in the
 * message's workspace scope, changes only its state.
 */
export const valoMessages = pgTable(
  "valo_messages",
  {
    id: uuid("id").primaryKey(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => valoWorkspaces.id),
    kind: text("kind").notNull(),
    class: text("class").notNull(),
    recipientIdentityId: text("recipient_identity_id").notNull(),
    subjectId: uuid("subject_id").notNull(),
    status: text("status").notNull().default("queued"),
    reason: text("reason"),
    attempts: integer("attempts").notNull().default(0),
    sender: text("sender"),
    providerMessageId: text("provider_message_id"),
    leaseToken: uuid("lease_token"),
    leaseUntil: timestamp("lease_until", { withTimezone: true }),
    nextAttemptAt: timestamp("next_attempt_at", { withTimezone: true }),
    firstAttemptAt: timestamp("first_attempt_at", { withTimezone: true }),
    lastAttemptAt: timestamp("last_attempt_at", { withTimezone: true }),
    acceptedAt: timestamp("accepted_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("valo_message_once").on(t.workspaceId, t.kind, t.subjectId),
    index("valo_message_dispatch_idx").on(t.status, t.nextAttemptAt),
    index("valo_message_workspace_idx").on(t.workspaceId, t.createdAt),
    // A delivery report names a message by the provider's reference alone.
    index("valo_message_provider_idx").on(t.providerMessageId),
    check(
      "valo_message_shape",
      sql`(${t.kind}, ${t.class}) IN (('purchase_receipt', 'necessary'), ('refund_processed', 'necessary'),
          ('notices_digest', 'necessary'))
        AND ${t.status} IN ('queued', 'sending', 'held', 'accepted', 'failed', 'cancelled')
        AND (${t.reason} IS NULL OR ${t.reason} ~ '^[A-Z][A-Z0-9_]{2,63}$')
        AND ${t.attempts} BETWEEN 0 AND 5
        AND (${t.sender} IS NULL OR ${t.sender} ~ '^[a-z][a-z0-9-]{1,39}$')
        AND (${t.providerMessageId} IS NULL OR length(${t.providerMessageId}) BETWEEN 1 AND 200)
        AND length(${t.recipientIdentityId}) BETWEEN 1 AND 200`,
    ),
    check(
      "valo_message_state",
      sql`(${t.status} = 'sending') = (${t.leaseToken} IS NOT NULL AND ${t.leaseUntil} IS NOT NULL)
        AND (${t.status} <> 'sending' OR ${t.attempts} >= 1)
        AND (${t.status} <> 'accepted' OR (${t.sender} IS NOT NULL AND ${t.providerMessageId} IS NOT NULL
          AND ${t.acceptedAt} IS NOT NULL))
        AND (${t.acceptedAt} IS NULL OR ${t.status} = 'accepted')
        AND (${t.attempts} = 0) = (${t.firstAttemptAt} IS NULL)
        AND (${t.attempts} = 0) = (${t.lastAttemptAt} IS NULL)`,
    ),
    workspaceRowPolicy(t.workspaceId),
  ],
);
export type ValoMessage = typeof valoMessages.$inferSelect;
