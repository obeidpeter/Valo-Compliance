import { sql } from "drizzle-orm";
import { NoteSourceReviewBody } from "@workspace/api-zod";
import { ValoProblem } from "../../platform/valo-problem";
import { assertDevelopmentRuntime } from "../../platform/valo-development-runtime";
import { requireSourceStaff, type SourceStaffActor } from "./valo-source-controls";
import { sourceTime, type SourceReader, type SourceTx } from "./valo-source-state";

/**
 * Review work with its owner (docs/architecture/source-register.md, slice 3, ADM-008 and CMP-007). Each
 * hold on a version opens a row of review work. The queue lists the open rows oldest first, with what
 * opened each, who is accountable for it and what was checked on it, and the rows closed lately with how
 * they closed. A Content editor is accountable for a template or guide, and for a rule released on the
 * reviewed route; the development owner for a rule the owner signed.
 */
export type ReviewOpener =
  | "daily_check"
  | "check_overdue"
  | "source_retired"
  | "staff"
  | "review_due"
  | "lifecycle"
  | "publisher"
  | "derived"
  | "other";
const openers: Record<string, ReviewOpener> = {
  check: "daily_check",
  stale: "check_overdue",
  retired: "source_retired",
  staff: "staff",
  "review-due": "review_due",
  lifecycle: "lifecycle",
  "publisher-withdraw": "publisher",
  derived: "derived",
};
/** What opened a row, read from the key of the hold that opened it. */
export function reviewOpener(dedupe: string): ReviewOpener {
  return openers[dedupe.split(":")[0] ?? ""] ?? "other";
}

const ownerSigned = sql`exists(select 1 from valo_rule_owner_signoffs s
  where i.target_kind='rule' and s.rule_id=i.target_key and s.version=i.target_version)`;

/** The queue, or only the rows of the rules the owner signed. */
export async function reviewWorkQueue(tx: SourceReader, options: { ownerOnly?: boolean } = {}) {
  const only = options.ownerOnly ? sql`and ${ownerSigned}` : sql``;
  const open = (
    await tx.execute(sql`select w.id,w.created_at,i.target_kind,i.target_key,i.target_version,i.reason,i.source_id,
      i.actor_id,i.dedupe_key,${ownerSigned} as owner_signed
      from valo_source_review_work w join valo_source_impacts i on i.id=w.impact_id
      where w.status='awaiting_authorized_review' ${only} order by w.created_at,w.id limit 100`)
  ).rows;
  const ids = open.map((row) => String(row.id));
  const notes = ids.length
    ? (
        await tx.execute(sql`select work_id,note,recorded_by,created_at from valo_source_review_notes
          where work_id in (${sql.join(
            ids.map((id) => sql`${id}::uuid`),
            sql`,`,
          )}) order by created_at,id`)
      ).rows
    : [];
  const closed = (
    await tx.execute(sql`select w.id,w.status,w.completed_at,i.target_kind,i.target_key,i.target_version,i.reason
      from valo_source_review_work w join valo_source_impacts i on i.id=w.impact_id
      where w.status<>'awaiting_authorized_review' ${only} order by w.completed_at desc nulls last,w.id limit 20`)
  ).rows;
  const iso = (value: unknown) => new Date(sourceTime(value)).toISOString();
  const target = (row: Record<string, unknown>) => ({
    targetKind: row.target_kind === "rule" ? ("rule" as const) : ("content" as const),
    targetKey: String(row.target_key),
    targetVersion: Number(row.target_version),
    reason: String(row.reason),
  });
  return {
    open: open.map((row) => ({
      id: String(row.id),
      ...target(row),
      sourceId: row.source_id ? String(row.source_id) : null,
      openedBy: String(row.actor_id),
      opener: reviewOpener(String(row.dedupe_key)),
      accountable: row.owner_signed ? ("owner" as const) : ("content" as const),
      createdAt: iso(row.created_at),
      notes: notes
        .filter((note) => String(note.work_id) === String(row.id))
        .map((note) => ({
          note: String(note.note),
          recordedBy: String(note.recorded_by),
          createdAt: iso(note.created_at),
        })),
    })),
    closed: closed.map((row) => ({
      id: String(row.id),
      ...target(row),
      outcome: row.status === "withdrawn" ? ("withdrawn" as const) : ("superseded" as const),
      completedAt: row.completed_at ? iso(row.completed_at) : null,
    })),
  };
}

/** What was checked, as the request gives it: 20 to 1,000 characters once trimmed. */
export function reviewNoteText(value: unknown) {
  const note = NoteSourceReviewBody.strict().parse(value).note.trim();
  if (note.length < 20 || note.length > 1000)
    throw new ValoProblem(422, "Say what was checked, in 20 to 1,000 characters.");
  return note;
}

/** Records what was checked on an open row. The database dates it and never changes or removes it. */
export async function addReviewNote(tx: SourceTx, workId: string, note: string, recordedBy: string) {
  const [row] = (
    await tx.execute(sql`select status from valo_source_review_work where id=${workId}::uuid for update`)
  ).rows;
  if (!row) throw new ValoProblem(404, "This review work is not in the queue.");
  if (row.status !== "awaiting_authorized_review")
    throw new ValoProblem(409, "This review work has closed. Reopen the queue.");
  await tx.execute(
    sql`insert into valo_source_review_notes(work_id,note,recorded_by) values(${workId}::uuid,${note},${recordedBy})`,
  );
}

function pgCode(error: unknown) {
  const e = error as { cause?: { code?: string }; code?: string };
  return (e.cause ?? e).code;
}
async function asContentEditor<T>(actor: SourceStaffActor, work: (tx: SourceTx) => Promise<T>) {
  assertDevelopmentRuntime();
  const { db } = await import("@workspace/db");
  try {
    return await db.transaction(async (tx) => {
      await requireSourceStaff(tx, actor, "content");
      return work(tx);
    });
  } catch (error) {
    // A database the review migration has not reached has no notes.
    if (pgCode(error) === "42P01")
      throw new ValoProblem(503, "Apply the source review migration before using the review queue.");
    throw error;
  }
}

/** The queue, for an active Content editor. */
export function listSourceReview(actor: SourceStaffActor) {
  return asContentEditor(actor, (tx) => reviewWorkQueue(tx));
}

/** A Content editor records what was checked on an open row. */
export function noteSourceReview(actor: SourceStaffActor, workId: string, value: unknown) {
  const note = reviewNoteText(value);
  return asContentEditor(actor, async (tx) => {
    await addReviewNote(tx, workId, note, actor.identityId);
    return reviewWorkQueue(tx);
  });
}
