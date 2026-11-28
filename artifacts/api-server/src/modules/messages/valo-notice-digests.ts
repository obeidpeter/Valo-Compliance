import { randomUUID } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { db, valoNoticeDigests } from "@workspace/db";
import { NOTICES_MESSAGE_DAYS_BACK, NOTICES_NAMED, noticesOpenDay } from "./message-policy";
import { messagesReady, queueMessage } from "./valo-messages";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/**
 * The notices that are emailed as well as shown in the app (docs/architecture/messages.md, part 7). Each
 * is written for a workspace the change affects, as the change is made:
 * - every correction notice: one of the workspace's tasks, saved results, documents or purchases used a
 *   source or a version that is now held or withdrawn;
 * - every rule notice: a requirements-check rule's version the workspace saved a result or made a task
 *   from was replaced or withdrawn;
 * - a template's withdrawal. A template's replacement by a later edition is shown in the app only.
 *
 * The choice is a proposal for the owner. It is written once here, as the part of a query that lists a
 * workspace's emailed notices with the Lagos day each was made on.
 */
const emailedNotices = sql`(
  select workspace_id, created_at from valo_correction_notices
  union all
  select workspace_id, created_at from valo_rule_notices
  union all
  select workspace_id, created_at from valo_edition_notices where kind = 'withdrawn'
)`;
const lagosDayOf = (column: ReturnType<typeof sql>) => sql`(${column} at time zone 'Africa/Lagos')::date`;

/** How many days' notices one run records. The task runs each minute, so the rest follow. */
const RUN_LIMIT = 200;
/**
 * The Lagos day up to which this process has found every day's notices recorded. Finding the days still
 * owed reads the notices of the last week, so it is done once for a day, not each minute: a notice is
 * dated when the change that makes it begins, so none of a day that ended seven hours ago is made later.
 */
let settledThrough: string | null = null;

/**
 * Whether the notice digests migration has reached this database, as `messagesReady` asks of its own.
 * Until it has, no day's notices owe a message, and there is none to list or remove.
 */
export async function noticeDigestsReady(tx: Pick<Tx, "execute">) {
  const [table] = (
    await tx.execute<{ present: boolean }>(
      sql`select to_regclass('valo_notice_digests') is not null as present`,
    )
  ).rows;
  return table?.present === true;
}

/**
 * Records that each ended day's emailed notices owe their workspace one message, and queues it
 * (docs/architecture/messages.md, part 7). A day is recorded from 07:00 the next morning on a Lagos
 * clock, so that every notice of the day is there and the message does not arrive in the night. A
 * workspace has one row for a day, so a second run, or a second worker, adds none.
 *
 * It runs on the application's own connection, as bookkeeping across workspaces: it reads only which
 * workspace has a notice on which day. Each workspace is locked against the start of its erasure, as the
 * corrections that write notices lock it, so a workspace whose erasure has begun is owed nothing.
 *
 * `scope` keeps a test's run to one workspace, and always looks.
 */
export async function oweNoticeDigests(now = new Date(), scope?: { workspaceId: string }) {
  const today = noticesOpenDay(now);
  if (!scope && settledThrough === today) return { owed: 0 };
  if (!(await messagesReady(db)) || !(await noticeDigestsReady(db))) return { owed: 0 };
  const result = await db.transaction(async (tx) => {
    const due = (
      await tx.execute<{ workspace_id: string; day: string }>(sql`
        select distinct n.workspace_id, ${lagosDayOf(sql`n.created_at`)}::text as day
        from ${emailedNotices} n
        where n.created_at >= ${today}::date - make_interval(days => ${NOTICES_MESSAGE_DAYS_BACK + 1})
          and ${lagosDayOf(sql`n.created_at`)} < ${today}::date
          and ${lagosDayOf(sql`n.created_at`)} >= ${today}::date - ${NOTICES_MESSAGE_DAYS_BACK}::int
          ${scope ? sql`and n.workspace_id = ${scope.workspaceId}::uuid` : sql``}
          and not exists (
            select 1 from valo_notice_digests d
            where d.workspace_id = n.workspace_id and d.day = ${lagosDayOf(sql`n.created_at`)}
          )
          and not exists (select 1 from valo_privacy_tombstones t where t.workspace_id = n.workspace_id)
        order by 1, 2
        limit ${RUN_LIMIT}`)
    ).rows;
    // Each workspace in a stable order, held against the start of its erasure until this commits. An
    // erasure that began since the list was read is seen here, under the lock.
    const owners = new Map<string, string>();
    for (const workspaceId of [...new Set(due.map((row) => row.workspace_id))].sort()) {
      const [workspace] = (
        await tx.execute<{ owner_identity_id: string }>(
          sql`select owner_identity_id from valo_workspaces where id = ${workspaceId}::uuid for share`,
        )
      ).rows;
      const [erasing] = (
        await tx.execute(
          sql`select 1 from valo_privacy_tombstones where workspace_id = ${workspaceId}::uuid limit 1`,
        )
      ).rows;
      if (workspace && !erasing) owners.set(workspaceId, workspace.owner_identity_id);
    }
    let owed = 0;
    for (const row of due) {
      const owner = owners.get(row.workspace_id);
      if (!owner) continue;
      const id = randomUUID();
      const made = await tx
        .insert(valoNoticeDigests)
        .values({ id, workspaceId: row.workspace_id, day: row.day })
        .onConflictDoNothing()
        .returning({ id: valoNoticeDigests.id });
      if (!made.length) continue;
      await queueMessage(tx, {
        workspaceId: row.workspace_id,
        kind: "notices_digest",
        recipientIdentityId: owner,
        subjectId: id,
      });
      owed++;
    }
    return { owed, drained: due.length < RUN_LIMIT };
  });
  if (!scope && result.drained) settledThrough = today;
  return { owed: result.owed };
}

/**
 * A day's emailed notices of one workspace, as their message names them: each rule's and each withdrawn
 * template's title, up to a number of each with a count of the rest, and how many of the workspace's
 * saved items a correction notice asks it to review. It is read in the workspace's own scope, as the
 * message is composed.
 */
export async function dayNotices(tx: Pick<Tx, "execute" | "select">, workspaceId: string, digestId: string) {
  const [digest] = await tx
    .select({ day: valoNoticeDigests.day })
    .from(valoNoticeDigests)
    .where(and(eq(valoNoticeDigests.workspaceId, workspaceId), eq(valoNoticeDigests.id, digestId)));
  if (!digest) return null;
  const onDay = (table: "valo_rule_notices" | "valo_edition_notices" | "valo_correction_notices") =>
    sql`workspace_id = ${workspaceId}::uuid and ${lagosDayOf(sql`${sql.identifier(table)}.created_at`)} = ${digest.day}::date`;
  const rules = (
    await tx.execute<{ title: string; kind: "replaced" | "withdrawn"; total: number }>(sql`
      select title, kind, (count(*) over ())::int as total from valo_rule_notices
      where ${onDay("valo_rule_notices")} order by created_at, id limit ${NOTICES_NAMED}`)
  ).rows;
  const templates = (
    await tx.execute<{ title: string; total: number }>(sql`
      select title, (count(*) over ())::int as total from valo_edition_notices
      where ${onDay("valo_edition_notices")} and kind = 'withdrawn' order by created_at, id limit ${NOTICES_NAMED}`)
  ).rows;
  // A saved item two changes reached that day has two notices, and is one item to review.
  const [corrections] = (
    await tx.execute<{ total: number }>(sql`
      select count(distinct (entity_kind, entity_id))::int as total from valo_correction_notices
      where ${onDay("valo_correction_notices")}`)
  ).rows;
  return {
    day: digest.day,
    rules: rules.map(({ title, kind }) => ({ title, kind })),
    moreRules: Math.max(0, (rules[0]?.total ?? 0) - rules.length),
    templates: templates.map(({ title }) => ({ title })),
    moreTemplates: Math.max(0, (templates[0]?.total ?? 0) - templates.length),
    corrections: corrections?.total ?? 0,
  };
}
