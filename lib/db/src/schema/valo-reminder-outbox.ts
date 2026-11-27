import { pgTable, uuid, text, timestamp, integer, index, uniqueIndex, foreignKey } from "drizzle-orm/pg-core";
import { workspaceRowPolicy } from "./valo-workspace-scope";
import { createInsertSchema } from "drizzle-zod";
import { valoWorkspaces } from "./valo-workspaces";
import { valoTasks } from "./valo-tasks";
export const valoReminderOutbox = pgTable(
  "valo_reminder_outbox",
  {
    id: uuid("id").primaryKey(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => valoWorkspaces.id),
    taskId: uuid("task_id").notNull(),
    idempotencyKey: text("idempotency_key").notNull(),
    scheduledAt: timestamp("scheduled_at", { withTimezone: true }).notNull(),
    status: text("status").notNull(),
    reason: text("reason"),
    attempts: integer("attempts").notNull().default(0),
    providerMessageId: text("provider_message_id"),
    deliveredAt: timestamp("delivered_at", { withTimezone: true }),
    nextAttemptAt: timestamp("next_attempt_at", { withTimezone: true }),
    lastAttemptAt: timestamp("last_attempt_at", { withTimezone: true }),
    firstAttemptAt: timestamp("first_attempt_at", { withTimezone: true }),
    leaseToken: uuid("lease_token"),
    leaseUntil: timestamp("lease_until", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("valo_reminder_idempotency_unique").on(t.workspaceId, t.idempotencyKey),
    index("valo_reminder_dispatch_idx").on(t.status, t.scheduledAt),
    index("valo_reminder_workspace_idx").on(t.workspaceId, t.createdAt),
    index("valo_reminder_retry_idx").on(t.status, t.nextAttemptAt),
    // A delivery report names a reminder by the provider's reference alone.
    index("valo_reminder_provider_idx").on(t.providerMessageId),
    foreignKey({
      name: "valo_reminder_task_tenant_fk",
      columns: [t.workspaceId, t.taskId],
      foreignColumns: [valoTasks.workspaceId, valoTasks.id],
    }),
    workspaceRowPolicy(t.workspaceId),
  ],
);
export const insertValoReminderOutboxSchema = createInsertSchema(valoReminderOutbox);
export type ValoReminderOutbox = typeof valoReminderOutbox.$inferSelect;
