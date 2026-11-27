import { and, asc, eq, gt, inArray, lt, ne, or, sql } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import {
  db,
  runInWorkspaceScope,
  valoEmailEvents,
  valoMessageDeliveries,
  valoMessages,
  valoReminderOutbox,
  type ValoEmailEvent,
} from "@workspace/db";
import { isDelivery, saysMore, type Delivery, type EmailReport } from "./email-events";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/**
 * How long a report waits for the record it is about. The provider can report on a message before the
 * attempt that handed it over has recorded the provider's reference; an hour is far longer than that
 * takes. After it, a report no record holds the reference of is `unmatched`.
 */
const WAITS_FOR_ITS_RECORD_MS = 60 * 60_000;
/** How long a report is kept once it is settled. What it said stays on the record it was about. */
const KEPT_ONCE_SETTLED_MS = 30 * 24 * 60 * 60_000;
/** How many reports one run looks at: a page at a time, so that reports still waiting never hold others back. */
const PAGE = 200,
  PAGES = 10;
/** The provider the reminders' own adapter sends through (modules/tasks/valo-reminder-resend.ts). */
const REMINDERS_PROVIDER = "resend";

/**
 * Whether the delivery migration has reached this database: whether both of its tables, and the messages
 * table before them, are there by the names a query would find them under. The Replit development
 * database is given each migration by hand, so this code can run before they exist. Until they do, no
 * report is taken or recorded, and everything else carries on.
 */
export async function emailEventsReady(tx: Pick<Tx, "execute">) {
  const [tables] = (
    await tx.execute<{ present: boolean }>(
      sql`select to_regclass('valo_email_events') is not null
        and to_regclass('valo_message_deliveries') is not null
        and to_regclass('valo_messages') is not null as present`,
    )
  ).rows;
  return tables?.present === true;
}

/**
 * Keeps one signed report until the worker's messages job records it (docs/architecture/messages.md,
 * part 3). The provider's own id for the report makes one delivered twice a single row. In a database the
 * delivery migration has not reached, nothing is kept, and the caller is told so.
 */
export async function recordEmailEvent(provider: string, eventKey: string, report: EmailReport) {
  if (!(await emailEventsReady(db))) return "not_ready" as const;
  const [kept] = await db
    .insert(valoEmailEvents)
    .values({
      id: randomUUID(),
      provider,
      eventKey,
      delivery: report.delivery,
      detail: report.detail,
      providerMessageId: report.providerMessageId,
      occurredAt: report.occurredAt,
    })
    .onConflictDoNothing()
    .returning({ id: valoEmailEvents.id });
  return kept ? ("kept" as const) : ("duplicate" as const);
}

type Reported = { source: "message" | "reminder"; id: string; workspaceId: string };

/**
 * The records a report is about: each message the report's provider took under that reference, and each
 * reminder sent under it. A message the stand-in took is never among them: it was sent to no one, so no
 * provider's report can be about it, whatever reference the report names.
 */
async function reportedRecords(event: ValoEmailEvent): Promise<Reported[]> {
  const messages = await db
    .select({ id: valoMessages.id, workspaceId: valoMessages.workspaceId })
    .from(valoMessages)
    .where(
      and(
        eq(valoMessages.providerMessageId, event.providerMessageId),
        eq(valoMessages.sender, event.provider),
        eq(valoMessages.status, "accepted"),
      ),
    );
  const reminders =
    event.provider === REMINDERS_PROVIDER
      ? await db
          .select({ id: valoReminderOutbox.id, workspaceId: valoReminderOutbox.workspaceId })
          .from(valoReminderOutbox)
          .where(
            and(
              eq(valoReminderOutbox.providerMessageId, event.providerMessageId),
              eq(valoReminderOutbox.status, "sent"),
            ),
          )
      : [];
  return [
    ...messages.map((row) => ({ source: "message" as const, ...row })),
    ...reminders.map((row) => ({ source: "reminder" as const, ...row })),
  ];
}

/**
 * Records one report on one record, in the record's workspace scope: the record and its delivery row are
 * the workspace's own, and row-level security keeps every read and change to them. The record's row is
 * locked first, so two reports about it are recorded one after the other, and the one that says more
 * stands whichever came first.
 */
function recordReport(record: Reported, event: ValoEmailEvent, delivery: Delivery, now: Date) {
  return runInWorkspaceScope(record.workspaceId, () =>
    db.transaction(async (tx) => {
      if (record.source === "message") {
        const [row] = await tx
          .select({
            status: valoMessages.status,
            sender: valoMessages.sender,
            providerMessageId: valoMessages.providerMessageId,
          })
          .from(valoMessages)
          .where(and(eq(valoMessages.workspaceId, record.workspaceId), eq(valoMessages.id, record.id)))
          .for("update");
        if (
          row?.status !== "accepted" ||
          row.sender !== event.provider ||
          row.providerMessageId !== event.providerMessageId
        )
          return "gone";
      } else {
        const mine = and(
          eq(valoReminderOutbox.workspaceId, record.workspaceId),
          eq(valoReminderOutbox.id, record.id),
        );
        const [row] = await tx
          .select({
            status: valoReminderOutbox.status,
            providerMessageId: valoReminderOutbox.providerMessageId,
            deliveredAt: valoReminderOutbox.deliveredAt,
          })
          .from(valoReminderOutbox)
          .where(mine)
          .for("update");
        if (row?.status !== "sent" || row.providerMessageId !== event.providerMessageId) return "gone";
        // The reminder's own time of delivery, whatever else is reported before or after.
        if (delivery === "delivered" && !row.deliveredAt)
          await tx.update(valoReminderOutbox).set({ deliveredAt: event.occurredAt }).where(mine);
      }
      const about = and(
        eq(valoMessageDeliveries.workspaceId, record.workspaceId),
        eq(valoMessageDeliveries.source, record.source),
        eq(valoMessageDeliveries.recordId, record.id),
      );
      const [held] = await tx
        .select({ delivery: valoMessageDeliveries.delivery })
        .from(valoMessageDeliveries)
        .where(about);
      if (held && !saysMore(delivery, isDelivery(held.delivery) ? held.delivery : null)) return "kept";
      const report = { delivery, detail: event.detail, reportedAt: event.occurredAt, updatedAt: now };
      if (held) await tx.update(valoMessageDeliveries).set(report).where(about);
      else
        await tx.insert(valoMessageDeliveries).values({
          id: randomUUID(),
          workspaceId: record.workspaceId,
          source: record.source,
          recordId: record.id,
          ...report,
        });
      return "recorded";
    }),
  );
}

/**
 * The worker's part in delivery reports (part 3): records each waiting report on the message or reminder
 * it is about, each in that record's workspace scope. The report's own row, which names no workspace, is
 * settled outside the scope.
 *
 * - A report whose record is found is `applied`, whether or not it changed what the record holds.
 * - A report no record holds the reference of waits an hour for it, and is then `unmatched`.
 * - A settled report is removed thirty days later.
 */
export async function recordDeliveryReports(now = new Date()) {
  const result = { applied: 0, waiting: 0, unmatched: 0, removed: 0 };
  // A database the delivery migration has not reached holds no report.
  if (!(await emailEventsReady(db))) return result;
  let failures = 0,
    after: { receivedAt: Date; id: string } | undefined;
  for (let page = 0; page < PAGES; page++) {
    const waiting = await db
      .select()
      .from(valoEmailEvents)
      .where(
        and(
          eq(valoEmailEvents.status, "pending"),
          after
            ? or(
                gt(valoEmailEvents.receivedAt, after.receivedAt),
                and(eq(valoEmailEvents.receivedAt, after.receivedAt), gt(valoEmailEvents.id, after.id)),
              )
            : undefined,
        ),
      )
      .orderBy(asc(valoEmailEvents.receivedAt), asc(valoEmailEvents.id))
      .limit(PAGE);
    for (const event of waiting)
      try {
        const settle = (status: "applied" | "unmatched") =>
          db
            .update(valoEmailEvents)
            .set({ status, settledAt: now })
            .where(and(eq(valoEmailEvents.id, event.id), eq(valoEmailEvents.status, "pending")));
        if (!isDelivery(event.delivery)) throw Error("EMAIL_EVENT_DELIVERY_UNKNOWN");
        const records = await reportedRecords(event);
        if (!records.length) {
          if (+now - +event.receivedAt < WAITS_FOR_ITS_RECORD_MS) result.waiting++;
          else {
            await settle("unmatched");
            result.unmatched++;
          }
          continue;
        }
        for (const record of records) await recordReport(record, event, event.delivery, now);
        await settle("applied");
        result.applied++;
      } catch {
        // One report that cannot be recorded now does not hold back the others. It stays waiting, the
        // run fails once every report was looked at, and the next run tries it again.
        failures++;
      }
    const last = waiting.at(-1);
    if (waiting.length < PAGE || !last) break;
    after = { receivedAt: last.receivedAt, id: last.id };
  }
  result.removed = (
    await db
      .delete(valoEmailEvents)
      .where(
        and(
          ne(valoEmailEvents.status, "pending"),
          lt(valoEmailEvents.settledAt, new Date(+now - KEPT_ONCE_SETTLED_MS)),
        ),
      )
      .returning({ id: valoEmailEvents.id })
  ).length;
  if (failures) throw Error(`DELIVERY_REPORTS_PARTIALLY_FAILED_${failures}`);
  return result;
}

/**
 * What the email provider last reported about each of a workspace's records of one kind, by the record's
 * id, for the workspace's own log. A record with nothing here has no report. A database the delivery
 * migration has not reached has none.
 */
export async function deliveriesOf(
  tx: Pick<Tx, "execute" | "select">,
  workspaceId: string,
  source: "message" | "reminder",
  recordIds: readonly string[],
) {
  const reports = new Map<string, { delivery: Delivery; deliveryAt: string }>();
  if (!recordIds.length || !(await emailEventsReady(tx))) return reports;
  const rows = await tx
    .select({
      recordId: valoMessageDeliveries.recordId,
      delivery: valoMessageDeliveries.delivery,
      reportedAt: valoMessageDeliveries.reportedAt,
    })
    .from(valoMessageDeliveries)
    .where(
      and(
        eq(valoMessageDeliveries.workspaceId, workspaceId),
        eq(valoMessageDeliveries.source, source),
        inArray(valoMessageDeliveries.recordId, [...recordIds]),
      ),
    );
  for (const row of rows)
    if (isDelivery(row.delivery))
      reports.set(row.recordId, { delivery: row.delivery, deliveryAt: row.reportedAt.toISOString() });
  return reports;
}
