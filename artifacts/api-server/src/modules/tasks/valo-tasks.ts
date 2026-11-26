import { randomUUID } from "node:crypto";
import { and, desc, eq, inArray, isNull, ne, sql } from "drizzle-orm";
import { valoTasks, valoReminderPreferences, valoReminderOutbox, valoRuleNotices } from "@workspace/db";
import {
  CreateTaskBody,
  UpdateTaskBody,
  DeleteTaskBody,
  SaveReminderPreferencesBody,
  GetReminderPreferencesResponse,
  CreateTaskResponse,
  ListRemindersResponse,
} from "@workspace/api-zod";
import { z } from "zod";
import type { WorkspaceActor } from "../workspaces";
import { ValoProblem } from "../../platform/valo-problem";
import {
  assessmentRow,
  serializeAssessment,
  workspaceReadTransaction,
  workspaceTransaction,
  workspaceEvent,
  releasedRegistry,
  currentSourceTaskRecommendation,
  type WorkspaceTx,
} from "../rules";
import { reminderEmailConfiguration, automaticReminderDeliveryReady } from "./valo-reminder-resend";
import { singleRow } from "../../platform/rows";
import { recordConsentChange } from "../../lib/consent-changes";

const emailBlocker =
  "Development email needs an approved sender and an owner-controlled test recipient. Preferences are saved; inbox delivery has not been verified.";
const taskInput = CreateTaskBody.strict()
  .refine((i) => Boolean(i.title.trim()), "A title is required")
  .refine(
    (i) => i.dueDate === null || z.string().date().safeParse(i.dueDate).success,
    "Invalid calendar date",
  )
  .refine((i) => i.dueDate === null || i.dateConfirmed, "Confirm a date before scheduling a reminder")
  .refine((i) => !i.ruleId || Boolean(i.assessmentId), "An assessment is required for a source-linked task");
const taskUpdate = UpdateTaskBody.strict()
  .refine((i) => Boolean(i.title.trim()), "A title is required")
  .refine(
    (i) => i.dueDate === null || z.string().date().safeParse(i.dueDate).success,
    "Invalid calendar date",
  )
  .refine((i) => i.dueDate === null || i.dateConfirmed, "Confirm the date before scheduling");
export function reminderInstant(dueDate: string, offset: number) {
  z.string().date().parse(dueDate);
  if (![0, 1, 3, 7, 14].includes(offset))
    throw new ValoProblem(422, "That is not one of the reminder times on offer.");
  // Africa/Lagos uses UTC+01:00. User-selected calendar date at 09:00 local, never an inferred statutory date.
  return new Date(new Date(`${dueDate}T09:00:00+01:00`).getTime() - offset * 86400000);
}
type RuleChange = {
  ruleId: string;
  version: number;
  kind: "replaced" | "withdrawn";
  replacementVersion: number | null;
  reason: string;
  changedAt: string;
};
function taskDto(row: typeof valoTasks.$inferSelect, ruleChange?: RuleChange) {
  return CreateTaskResponse.parse({
    ...row,
    ...(row.needsReview && ruleChange && { ruleChange }),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  });
}
/**
 * docs/architecture/rule-changes.md, slice 3: for each listed task made from a rule version that was
 * replaced or withdrawn, that change, from the workspace's own rule notices, read or not. Keyed
 * `ruleId@version`.
 */
async function taskRuleChanges(
  tx: WorkspaceTx,
  actor: WorkspaceActor,
  rows: readonly (typeof valoTasks.$inferSelect)[],
) {
  const linked = rows.filter((row) => row.ruleId && row.ruleVersion !== null && row.needsReview);
  const changes = new Map<string, RuleChange>();
  if (!linked.length) return changes;
  const notices = await tx
    .select()
    .from(valoRuleNotices)
    .where(
      and(
        eq(valoRuleNotices.workspaceId, actor.workspaceId),
        inArray(
          valoRuleNotices.ruleId,
          linked.map((row) => row.ruleId!),
        ),
      ),
    )
    .orderBy(valoRuleNotices.createdAt, valoRuleNotices.id);
  for (const notice of notices)
    changes.set(`${notice.ruleId}@${notice.version}`, {
      ruleId: notice.ruleId,
      version: notice.version,
      kind: notice.kind as RuleChange["kind"],
      replacementVersion: notice.replacementVersion,
      reason: notice.reason,
      changedAt: notice.createdAt.toISOString(),
    });
  return changes;
}
async function findTask(tx: WorkspaceTx, actor: WorkspaceActor, id: string) {
  const [row] = await tx
    .select()
    .from(valoTasks)
    .where(
      and(eq(valoTasks.workspaceId, actor.workspaceId), eq(valoTasks.id, id), isNull(valoTasks.deletedAt)),
    );
  if (!row) throw new ValoProblem(404, "This task was not found in your workspace.");
  return row;
}
async function cancelOutstanding(
  tx: WorkspaceTx,
  actor: WorkspaceActor,
  taskId?: string,
  reason = "PREFERENCES_CHANGED",
) {
  await tx
    .update(valoReminderOutbox)
    .set({ status: "cancelled", reason, leaseToken: null, leaseUntil: null, nextAttemptAt: null })
    .where(
      and(
        eq(valoReminderOutbox.workspaceId, actor.workspaceId),
        ne(valoReminderOutbox.status, "sent"),
        taskId ? eq(valoReminderOutbox.taskId, taskId) : undefined,
      ),
    );
}
type ReleasedRegistry = Awaited<ReturnType<typeof releasedRegistry>>;
type ScheduleContext = {
  prefs?: typeof valoReminderPreferences.$inferSelect | null;
  getRegistry?: () => Promise<ReleasedRegistry>;
  now?: Date;
};
async function scheduleTask(
  tx: WorkspaceTx,
  actor: WorkspaceActor,
  task: typeof valoTasks.$inferSelect,
  context?: ScheduleContext,
) {
  const prefs =
    context?.prefs !== undefined
      ? context.prefs
      : (
          await tx
            .select()
            .from(valoReminderPreferences)
            .where(eq(valoReminderPreferences.workspaceId, actor.workspaceId))
        )[0];
  if (
    !prefs?.enabled ||
    !task.dueDate ||
    !task.dateConfirmed ||
    task.deletedAt ||
    task.state === "completed_by_user" ||
    task.needsReview
  )
    return;
  const now = context?.now ?? new Date();
  if (task.ruleId) {
    const registry = context?.getRegistry ? await context.getRegistry() : await releasedRegistry(tx, now);
    const day = new Date(now.getTime() + 3600000).toISOString().slice(0, 10);
    if (
      !registry.rules.some(
        (r) =>
          r.id === task.ruleId &&
          r.version === task.ruleVersion &&
          Date.parse(r.reviewBy) > now.getTime() &&
          r.validFrom <= day &&
          (r.validTo === null || r.validTo > day),
      )
    ) {
      await tx
        .update(valoTasks)
        .set({ needsReview: true })
        .where(and(eq(valoTasks.id, task.id), eq(valoTasks.workspaceId, actor.workspaceId)));
      task.needsReview = true;
      return;
    }
  }
  for (const offset of prefs.offsets) {
    const scheduledAt = reminderInstant(task.dueDate, offset);
    if (scheduledAt <= now) continue; // Do not backdate a new reminder.
    const idempotencyKey = `${task.id}/${task.dueDate}/${offset}`;
    await tx
      .insert(valoReminderOutbox)
      .values({
        id: randomUUID(),
        workspaceId: actor.workspaceId,
        taskId: task.id,
        idempotencyKey,
        scheduledAt,
        status: "held",
        reason: "EMAIL_PROVIDER_NOT_CONFIGURED",
      })
      .onConflictDoUpdate({
        target: [valoReminderOutbox.workspaceId, valoReminderOutbox.idempotencyKey],
        set: { scheduledAt, status: "held", reason: "EMAIL_PROVIDER_NOT_CONFIGURED" },
        setWhere: ne(valoReminderOutbox.status, "sent"),
      });
  }
}
async function markIneligibleSourceTasks(
  tx: WorkspaceTx,
  actor: WorkspaceActor,
  rows: (typeof valoTasks.$inferSelect)[],
) {
  const candidates = rows.filter((row) => row.ruleId && !row.needsReview);
  if (candidates.length === 0) return;
  const registry = await releasedRegistry(tx, new Date());
  for (const row of candidates) {
    if (!registry.rules.some((r) => r.id === row.ruleId && r.version === row.ruleVersion)) {
      await tx
        .update(valoTasks)
        .set({ needsReview: true })
        .where(and(eq(valoTasks.id, row.id), eq(valoTasks.workspaceId, actor.workspaceId)));
      row.needsReview = true;
      await cancelOutstanding(tx, actor, row.id, "SOURCE_NO_LONGER_ELIGIBLE");
      await workspaceEvent(tx, actor, "task.source_review_required", row.id, row.revision);
    }
  }
}
export async function createTask(actor: WorkspaceActor, raw: unknown) {
  const input = taskInput.parse(raw);
  return workspaceTransaction(actor, async (tx) => {
    let ruleVersion: number | null = null;
    let checkedRegistry: ReleasedRegistry | undefined;
    let checkedNow: Date | undefined;
    if (input.assessmentId) {
      const saved = serializeAssessment(await assessmentRow(tx, actor, input.assessmentId));
      if (input.ruleId) {
        const item = saved.result.items.find(
          (i) =>
            i.ruleId === input.ruleId &&
            i.label === "Likely relevant" &&
            i.sourceLinkedTaskEligible !== false,
        );
        if (!item)
          throw new ValoProblem(
            422,
            'This saved result does not offer a task for that item. A task can be made only from an item marked "Likely relevant".',
          );
        const now = new Date(),
          current = await releasedRegistry(tx, now);
        if (!currentSourceTaskRecommendation(saved.facts, current, item.ruleId, item.ruleVersion, now))
          throw new ValoProblem(
            409,
            "This item is out of date. Run the check again before you make a task from it.",
          );
        ruleVersion = item.ruleVersion;
        checkedRegistry = current;
        checkedNow = now;
      }
    }
    const row = singleRow(
      await tx
        .insert(valoTasks)
        .values({
          ...input,
          ruleVersion,
          id: randomUUID(),
          workspaceId: actor.workspaceId,
          actorId: actor.identityId,
        })
        .returning(),
    );
    await scheduleTask(
      tx,
      actor,
      row,
      checkedRegistry && checkedNow
        ? { getRegistry: async () => checkedRegistry, now: checkedNow }
        : undefined,
    );
    await workspaceEvent(tx, actor, "task.created", row.id, 1);
    return taskDto(row);
  });
}
export async function listTasksPage(actor: WorkspaceActor, raw: unknown) {
  const query = z
    .object({
      page: z.coerce.number().int().min(1).max(100000).default(1),
      filter: z.enum(["open", "done", "all"]).default("open"),
    })
    .strict()
    .parse(raw);
  return workspaceTransaction(actor, async (tx) => {
    const owned = and(eq(valoTasks.workspaceId, actor.workspaceId), isNull(valoTasks.deletedAt));
    const counts = singleRow(
      await tx
        .select({
          total: sql<number>`count(*)::int`,
          openCount: sql<number>`count(*) filter (where ${valoTasks.state}<>'completed_by_user')::int`,
        })
        .from(valoTasks)
        .where(owned),
    );
    const filteredTotal =
      query.filter === "all"
        ? counts.total
        : query.filter === "open"
          ? counts.openCount
          : counts.total - counts.openCount;
    const pageSize = 20;
    const rows = await tx
      .select()
      .from(valoTasks)
      .where(
        and(
          owned,
          query.filter === "all"
            ? undefined
            : query.filter === "done"
              ? eq(valoTasks.state, "completed_by_user")
              : ne(valoTasks.state, "completed_by_user"),
        ),
      )
      .orderBy(desc(valoTasks.updatedAt), desc(valoTasks.id))
      .limit(pageSize)
      .offset((query.page - 1) * pageSize);
    await markIneligibleSourceTasks(tx, actor, rows);
    const changes = await taskRuleChanges(tx, actor, rows);
    return {
      items: rows.map((row) => taskDto(row, changes.get(`${row.ruleId}@${row.ruleVersion}`))),
      total: counts.total,
      openCount: counts.openCount,
      filteredTotal,
      page: query.page,
      pageSize,
      hasNext: query.page * pageSize < filteredTotal,
    };
  });
}
export async function listTasks(actor: WorkspaceActor) {
  return workspaceTransaction(actor, async (tx) => {
    const rows = await tx
      .select()
      .from(valoTasks)
      .where(and(eq(valoTasks.workspaceId, actor.workspaceId), isNull(valoTasks.deletedAt)))
      .orderBy(desc(valoTasks.updatedAt))
      .limit(200);
    await markIneligibleSourceTasks(tx, actor, rows);
    const changes = await taskRuleChanges(tx, actor, rows);
    return rows.map((row) => taskDto(row, changes.get(`${row.ruleId}@${row.ruleVersion}`)));
  });
}
export async function updateTask(actor: WorkspaceActor, id: string, raw: unknown) {
  const { expectedRevision, ...input } = taskUpdate.parse(raw);
  return workspaceTransaction(actor, async (tx) => {
    const old = await findTask(tx, actor, id);
    if (old.revision !== expectedRevision)
      throw new ValoProblem(
        409,
        "This task was changed somewhere else after you opened it. Your unsaved notes were not overwritten.",
        old.revision,
      );
    const row = singleRow(
      await tx
        .update(valoTasks)
        .set({ ...input, revision: expectedRevision + 1, updatedAt: new Date() })
        .where(and(eq(valoTasks.workspaceId, actor.workspaceId), eq(valoTasks.id, id)))
        .returning(),
    );
    await cancelOutstanding(tx, actor, id, "TASK_CHANGED");
    await scheduleTask(tx, actor, row);
    await workspaceEvent(tx, actor, "task.updated", id, row.revision);
    return taskDto(row);
  });
}
export async function deleteTask(actor: WorkspaceActor, id: string, raw: unknown) {
  const input = DeleteTaskBody.strict().parse(raw);
  return workspaceTransaction(actor, async (tx) => {
    const task = await findTask(tx, actor, id);
    if (task.revision !== input.expectedRevision)
      throw new ValoProblem(
        409,
        "This task was changed somewhere else. Look at it again before you archive it.",
        task.revision,
      );
    await tx
      .update(valoTasks)
      .set({ deletedAt: new Date(), revision: task.revision + 1 })
      .where(and(eq(valoTasks.workspaceId, actor.workspaceId), eq(valoTasks.id, id)));
    await cancelOutstanding(tx, actor, id, "TASK_ARCHIVED");
    await workspaceEvent(tx, actor, "task.archived", id, task.revision + 1);
  });
}
export async function getReminderPreferences(actor: WorkspaceActor) {
  return workspaceReadTransaction(actor, async (tx) => {
    const [row] = await tx
      .select()
      .from(valoReminderPreferences)
      .where(eq(valoReminderPreferences.workspaceId, actor.workspaceId));
    return GetReminderPreferencesResponse.parse({
      enabled: row?.enabled ?? false,
      offsets: row?.offsets ?? [1],
      revision: row?.revision ?? 0,
      timezone: "Africa/Lagos",
      deliveryAvailable: automaticReminderDeliveryReady(),
      deliveryBlocker: automaticReminderDeliveryReady()
        ? "Development test delivery only. Provider acceptance is not inbox delivery."
        : reminderEmailConfiguration()
          ? "Automatic reminder dispatch is paused. Preferences are saved; inbox delivery is unverified."
          : emailBlocker,
    });
  });
}
export async function saveReminderPreferences(actor: WorkspaceActor, raw: unknown) {
  const input = SaveReminderPreferencesBody.strict()
    .refine((i) => !i.enabled || i.offsets.length > 0, "Choose a reminder timing when reminders are enabled")
    .refine((i) => new Set(i.offsets).size === i.offsets.length, "Reminder offsets must be distinct")
    .parse(raw);
  await workspaceTransaction(actor, async (tx) => {
    const [old] = await tx
      .select()
      .from(valoReminderPreferences)
      .where(eq(valoReminderPreferences.workspaceId, actor.workspaceId));
    if ((old?.revision ?? 0) !== input.expectedRevision)
      throw new ValoProblem(
        409,
        "Your reminder settings were changed somewhere else after you opened them.",
        old?.revision ?? 0,
      );
    const values = {
      enabled: input.enabled,
      offsets: [...input.offsets].sort((a, b) => a - b),
      revision: input.expectedRevision + 1,
      consentVersion: "optional-task-reminders-v1",
      actorId: actor.identityId,
      updatedAt: new Date(),
    };
    // Turning reminders on or off is recorded with the notice in force (processing inventory, slice 4).
    if ((old?.enabled ?? false) !== input.enabled)
      await recordConsentChange(tx, {
        workspaceId: actor.workspaceId,
        actorId: actor.identityId,
        consent: "reminders",
        choice: input.enabled,
      });
    const savedPrefs = singleRow(
      await tx
        .insert(valoReminderPreferences)
        .values({ workspaceId: actor.workspaceId, ...values })
        .onConflictDoUpdate({ target: valoReminderPreferences.workspaceId, set: values })
        .returning(),
    );
    await cancelOutstanding(
      tx,
      actor,
      undefined,
      input.enabled ? "PREFERENCES_CHANGED" : "REMINDERS_OPTED_OUT",
    );
    if (input.enabled) {
      const tasks = await tx
        .select()
        .from(valoTasks)
        .where(and(eq(valoTasks.workspaceId, actor.workspaceId), isNull(valoTasks.deletedAt)));
      const now = new Date();
      let cachedRegistry: ReleasedRegistry | undefined;
      const getRegistry = async () => (cachedRegistry ??= await releasedRegistry(tx, now));
      for (const task of tasks) await scheduleTask(tx, actor, task, { prefs: savedPrefs, getRegistry, now });
    }
    await workspaceEvent(tx, actor, "reminders.preferences_saved", actor.workspaceId, values.revision);
  });
  return getReminderPreferences(actor);
}
export async function listReminders(actor: WorkspaceActor) {
  return workspaceReadTransaction(actor, async (tx) =>
    ListRemindersResponse.parse(
      (
        await tx
          .select()
          .from(valoReminderOutbox)
          .where(eq(valoReminderOutbox.workspaceId, actor.workspaceId))
          .orderBy(desc(valoReminderOutbox.createdAt))
          .limit(200)
      ).map((row) => ({
        ...row,
        scheduledAt: row.scheduledAt.toISOString(),
        deliveredAt: row.deliveredAt?.toISOString() ?? null,
        nextAttemptAt: row.nextAttemptAt?.toISOString() ?? null,
        lastAttemptAt: row.lastAttemptAt?.toISOString() ?? null,
      })),
    ),
  );
}
