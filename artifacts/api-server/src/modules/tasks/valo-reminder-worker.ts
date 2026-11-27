import { and, eq, inArray, lte, lt, or, isNull, isNotNull, sql } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import {
  db,
  runInWorkspaceScope,
  valoWorkspaces,
  valoTasks,
  valoReminderOutbox,
  valoReminderPreferences,
  type ValoReminderOutbox,
} from "@workspace/db";
import { ValoProblem } from "../../platform/valo-problem";
import { releasedRegistry, workspaceTransaction } from "../rules";
import { reminderInstant } from "./valo-tasks";
import { configuredReminderSender } from "./valo-reminder-resend";
import { ReminderAddressSuppressed, type ReminderSender } from "./valo-reminder-sender";
import { workspaceActorFromRecord } from "../../platform/workspace-context";

export type { ReminderSender } from "./valo-reminder-sender";
export const reminderAttemptLimit = 5;
export function reminderRetryAt(attempt: number, now: Date) {
  if (!Number.isInteger(attempt) || attempt < 1) throw Error("INVALID_REMINDER_ATTEMPT");
  return attempt >= reminderAttemptLimit ? null : new Date(+now + Math.min(60, 2 ** (attempt - 1)) * 60000);
}
type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
async function eligibleReminder(tx: Tx, workspaceId: string, row: ValoReminderOutbox, now: Date) {
  const [prefs] = await tx
    .select()
    .from(valoReminderPreferences)
    .where(eq(valoReminderPreferences.workspaceId, workspaceId));
  const [task] = await tx
    .select()
    .from(valoTasks)
    .where(and(eq(valoTasks.workspaceId, workspaceId), eq(valoTasks.id, row.taskId)));
  const offset = Number(row.idempotencyKey.split("/").at(-1));
  let reason: string | null = null,
    status = "cancelled";
  if (!prefs?.enabled) reason = "REMINDERS_OPTED_OUT";
  else if (
    !task ||
    task.deletedAt ||
    !task.dueDate ||
    !task.dateConfirmed ||
    task.state === "completed_by_user"
  )
    reason = "TASK_NO_LONGER_SCHEDULED";
  else if (task.needsReview || task.state === "needs_review") {
    reason = "TASK_REVIEW_REQUIRED";
    status = "held";
  } else if (
    !prefs.offsets.includes(offset) ||
    row.idempotencyKey !== `${task.id}/${task.dueDate}/${offset}` ||
    reminderInstant(task.dueDate, offset).getTime() !== row.scheduledAt.getTime()
  )
    reason = "SCHEDULE_CHANGED";
  if (!reason && task?.ruleId) {
    const registry = await releasedRegistry(tx, now),
      day = new Date(+now + 3600000).toISOString().slice(0, 10);
    if (
      !registry.rules.some(
        (r) =>
          r.id === task.ruleId &&
          r.version === task.ruleVersion &&
          Date.parse(r.reviewBy) > +now &&
          r.validFrom <= day &&
          (r.validTo === null || r.validTo > day),
      )
    ) {
      await tx
        .update(valoTasks)
        .set({ needsReview: true })
        .where(and(eq(valoTasks.workspaceId, workspaceId), eq(valoTasks.id, task.id)));
      reason = "SOURCE_NO_LONGER_ELIGIBLE";
      status = "held";
    }
  }
  return { reason, status, task };
}
/**
 * Delivers one due reminder of `workspaceId`. It runs in that workspace's database scope: every
 * table it reads or writes is one customer requests use, and row-level security keeps the
 * message, its recipient and its bookkeeping to the workspace's own rows.
 */
export function processReminder(
  workspaceId: string,
  id: string,
  sender: ReminderSender | null = null,
  now = new Date(),
) {
  return runInWorkspaceScope(workspaceId, () => deliverReminder(workspaceId, id, sender, now));
}
async function deliverReminder(workspaceId: string, id: string, sender: ReminderSender | null, now: Date) {
  const [workspace] = await db.select().from(valoWorkspaces).where(eq(valoWorkspaces.id, workspaceId));
  if (!workspace) throw new ValoProblem(404, "Workspace not found");
  const actor = workspaceActorFromRecord({ workspaceId, identityId: workspace.ownerIdentityId });
  // Commit the bounded attempt BEFORE network activity. A dead process cannot
  // erase its attempt. The lease makes abandoned work recoverable, not immortal.
  // Preferences, source freshness, date and membership are checked in the same
  // transaction, just before the call, not merely when the task was created.
  const claim = await workspaceTransaction(actor, async (tx) => {
    const [row] = await tx
      .select()
      .from(valoReminderOutbox)
      .where(and(eq(valoReminderOutbox.workspaceId, workspaceId), eq(valoReminderOutbox.id, id)))
      .for("update");
    if (!row) throw new ValoProblem(404, "Reminder not found");
    if (
      ["sent", "cancelled"].includes(row.status) ||
      row.scheduledAt > now ||
      (row.nextAttemptAt && row.nextAttemptAt > now)
    )
      return row.status;
    const eligible = await eligibleReminder(tx, workspaceId, row, now);
    if (eligible.reason) {
      await tx
        .update(valoReminderOutbox)
        .set({
          status: eligible.status,
          reason: eligible.reason,
          leaseToken: null,
          leaseUntil: null,
          nextAttemptAt: eligible.status === "held" ? new Date(+now + 15 * 60000) : null,
        })
        .where(and(eq(valoReminderOutbox.workspaceId, workspaceId), eq(valoReminderOutbox.id, id)));
      return eligible.status;
    }
    if (row.attempts >= reminderAttemptLimit) {
      await tx
        .update(valoReminderOutbox)
        .set({
          status: "failed",
          reason: "EMAIL_ATTEMPT_LIMIT_REACHED",
          leaseToken: null,
          leaseUntil: null,
          nextAttemptAt: null,
        })
        .where(and(eq(valoReminderOutbox.workspaceId, workspaceId), eq(valoReminderOutbox.id, id)));
      return "failed";
    }
    if (!sender) {
      await tx
        .update(valoReminderOutbox)
        .set({
          status: "held",
          reason: "EMAIL_PROVIDER_NOT_CONFIGURED",
          leaseToken: null,
          leaseUntil: null,
          nextAttemptAt: new Date(+now + 15 * 60000),
        })
        .where(and(eq(valoReminderOutbox.workspaceId, workspaceId), eq(valoReminderOutbox.id, id)));
      return "held";
    }
    if (
      sender.replayWindowMs &&
      row.attempts > 0 &&
      (!row.firstAttemptAt ||
        +row.firstAttemptAt > +now ||
        +now - +row.firstAttemptAt >= sender.replayWindowMs)
    ) {
      await tx
        .update(valoReminderOutbox)
        .set({
          status: "held",
          reason:
            row.firstAttemptAt && +row.firstAttemptAt <= +now
              ? "EMAIL_REPLAY_WINDOW_EXPIRED"
              : "EMAIL_FIRST_ATTEMPT_UNKNOWN",
          leaseToken: null,
          leaseUntil: null,
          nextAttemptAt: eligible.status === "held" ? new Date(+now + 15 * 60000) : null,
        })
        .where(eq(valoReminderOutbox.id, id));
      return "held";
    }
    if (!eligible.task?.dueDate) throw new ValoProblem(503, "Reminder dispatch context missing");
    const token = randomUUID(),
      leaseUntil = new Date(+now + 30000);
    await tx
      .update(valoReminderOutbox)
      .set({
        status: "pending",
        reason: "EMAIL_DISPATCH_IN_PROGRESS",
        attempts: row.attempts + 1,
        firstAttemptAt: row.firstAttemptAt ?? now,
        lastAttemptAt: now,
        nextAttemptAt: leaseUntil,
        leaseToken: token,
        leaseUntil,
      })
      .where(and(eq(valoReminderOutbox.workspaceId, workspaceId), eq(valoReminderOutbox.id, id)));
    return {
      token,
      attempt: row.attempts + 1,
      // What the row said of earlier tries, for a sender that turns out not to call the provider at all.
      before: {
        attempts: row.attempts,
        firstAttemptAt: row.firstAttemptAt,
        lastAttemptAt: row.lastAttemptAt,
      },
      message: {
        idempotencyKey: row.idempotencyKey,
        ownerIdentityId: workspace.ownerIdentityId,
        title: eligible.task.title,
        dueDate: eligible.task.dueDate,
        timezone: "Africa/Lagos" as const,
      },
    };
  });
  if (typeof claim === "string") return claim;
  // Unreachable: without a sender the claim above holds the reminder instead.
  if (!sender) throw new ValoProblem(503, "Reminder dispatch context missing");
  // The provider is called with no transaction, lock or pooled connection held. The lease keeps
  // other attempts away meanwhile; a call that outlives it is retried with the same idempotency
  // key, which the provider deduplicates.
  let providerMessageId: string | undefined,
    suppressed = false;
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        controller.abort();
        reject(Error("REMINDER_PROVIDER_TIMEOUT"));
      }, 18000);
    });
    const receipt = await Promise.race([
      sender.send({ ...claim.message, signal: controller.signal }),
      timeout,
    ]);
    if (!receipt.providerMessageId?.trim()) throw Error("EMAIL_PROVIDER_ACK_MISSING");
    providerMessageId = receipt.providerMessageId;
  } catch (error) {
    // A timeout may follow provider acceptance. A retry reuses the SAME provider idempotency
    // key; an unconfirmed message is never claimed as delivered.
    providerMessageId = undefined;
    // The sender did not call the provider at all: the address is one Valo has stopped sending to.
    suppressed = error instanceof ReminderAddressSuppressed;
  } finally {
    if (timer) clearTimeout(timer);
  }
  // The outcome is recorded whatever the owner's access is now: it describes a call already made.
  return db.transaction(async (tx) => {
    const [row] = await tx
      .select()
      .from(valoReminderOutbox)
      .where(and(eq(valoReminderOutbox.workspaceId, workspaceId), eq(valoReminderOutbox.id, id)))
      .for("update");
    if (!row) throw new ValoProblem(404, "Reminder not found");
    if (row.status === "sent") return "sent";
    if (providerMessageId) {
      // An accepted message is recorded as sent even if the reminder was cancelled or rescheduled
      // during the call, as it was when the call held this row's lock: the email has gone. A newer
      // attempt that took over an expired lease records its own result.
      if (row.leaseToken !== null && row.leaseToken !== claim.token) return row.status;
      await tx
        .update(valoReminderOutbox)
        .set({
          status: "sent",
          reason: null,
          providerMessageId,
          nextAttemptAt: null,
          leaseToken: null,
          leaseUntil: null,
        }) // Acceptance is not delivery.
        .where(and(eq(valoReminderOutbox.workspaceId, workspaceId), eq(valoReminderOutbox.id, id)));
      return "sent";
    }
    // A failed or unconfirmed call is recorded only if nothing changed the reminder since the
    // claim; a cancellation or new schedule made meanwhile stands, and any retry checks
    // eligibility again before calling the provider.
    if (row.leaseToken !== claim.token || row.status !== "pending") return row.status;
    if (suppressed) {
      // The provider was not called, so this was not a try: the count and the times of the tries go
      // back to what they were. Nothing will be sent, so the reminder ends here and is not tried again.
      await tx
        .update(valoReminderOutbox)
        .set({
          status: "cancelled",
          reason: "EMAIL_ADDRESS_SUPPRESSED",
          attempts: claim.before.attempts,
          firstAttemptAt: claim.before.firstAttemptAt,
          lastAttemptAt: claim.before.lastAttemptAt,
          nextAttemptAt: null,
          leaseToken: null,
          leaseUntil: null,
        })
        .where(and(eq(valoReminderOutbox.workspaceId, workspaceId), eq(valoReminderOutbox.id, id)));
      return "cancelled";
    }
    await tx
      .update(valoReminderOutbox)
      .set({
        status: "failed",
        reason:
          claim.attempt >= reminderAttemptLimit
            ? "EMAIL_ATTEMPT_LIMIT_REACHED"
            : "EMAIL_ACCEPTANCE_UNCONFIRMED",
        nextAttemptAt: reminderRetryAt(claim.attempt, now),
        leaseToken: null,
        leaseUntil: null,
      })
      .where(and(eq(valoReminderOutbox.workspaceId, workspaceId), eq(valoReminderOutbox.id, id)));
    return "failed";
  });
}
/** Database outbox is durable; polling is only a wake-up, never an in-memory job queue. */
export async function reconcileDueReminders(
  sender: ReminderSender | null = configuredReminderSender(),
  scope?: { workspaceId: string },
  now = new Date(),
) {
  const due = await db
    .select({ id: valoReminderOutbox.id, workspaceId: valoReminderOutbox.workspaceId })
    .from(valoReminderOutbox)
    .where(
      and(
        inArray(valoReminderOutbox.status, ["pending", "held", "failed"]),
        ...(scope ? [eq(valoReminderOutbox.workspaceId, scope.workspaceId)] : []),
        sql`coalesce(${valoReminderOutbox.reason},'') not in ('EMAIL_REPLAY_WINDOW_EXPIRED','EMAIL_FIRST_ATTEMPT_UNKNOWN')`,
        or(
          lt(valoReminderOutbox.attempts, reminderAttemptLimit),
          and(isNotNull(valoReminderOutbox.leaseToken), lte(valoReminderOutbox.leaseUntil, now)),
        ),
        lte(valoReminderOutbox.scheduledAt, now),
        or(isNull(valoReminderOutbox.nextAttemptAt), lte(valoReminderOutbox.nextAttemptAt, now)),
      ),
    )
    .orderBy(
      sql`${valoReminderOutbox.nextAttemptAt} asc nulls first`,
      valoReminderOutbox.scheduledAt,
      valoReminderOutbox.id,
    )
    .limit(25);
  let providerCalls = 0;
  const counted: ReminderSender | null = sender
    ? {
        replayWindowMs: sender.replayWindowMs,
        send: async (input) => {
          providerCalls++;
          return sender.send(input);
        },
      }
    : null;
  let failures = 0;
  for (const row of due)
    try {
      await processReminder(row.workspaceId, row.id, counted, now);
    } catch {
      failures++;
    }
  if (failures) throw Error(`REMINDER_BATCH_PARTIALLY_FAILED_${failures}`);
  return { checked: due.length, providerCalls, emailConfigured: sender !== null };
}
