import { randomUUID } from "node:crypto";
import { desc, sql } from "drizzle-orm";
import {
  db,
  valoHistoryChecks,
  valoPriceChanges,
  valoRefundTransitions,
  valoSafetyControlAudit,
  valoStaffAccessAudit,
} from "@workspace/db";
import { GetAuditHistoryQueryParams } from "@workspace/api-zod";
import type { StaffActor } from "./valo-staff-authority";
import { systemAuthority } from "./valo-staff-roles";

/** The histories no other staff screen shows (ADM-009, docs/architecture/audit-trail.md, slice 4). */
export type AuditHistoryKind = "access" | "safety" | "prices" | "refunds" | "counts";
export const AUDIT_HISTORY_PAGE_SIZE = 50;
const NOTICES: Record<AuditHistoryKind, string> = {
  access:
    "Every staff read, newest first: who read what, when and why. A read from before reads named what they read says 'unrecorded'.",
  safety: "Every source hold, safety control and release of one, newest first, with the reason given.",
  prices: "Every price change, newest first. The database names the login that made it.",
  refunds:
    "Every change to a refund's status, newest first. Its reason stays with finance, since it may hold a customer's own words.",
  counts:
    "Every hourly count of the histories, newest first, and any history whose digest it found no longer matching its rows.",
};
const PRICE_ACTIONS: Record<string, string> = {
  existing: "Price as it stood when the log began",
  created: "Price created",
  closed: "Price closed",
  deleted: "Price deleted",
};
export type AuditHistoryEntry = {
  id: string;
  at: Date;
  actor: string;
  action: string;
  object: string;
  reason: string | null;
};
/** The contract's limits; a longer value ends in an ellipsis, and the row itself keeps all of it. */
const clip = (text: string, length: number) =>
  text.length > length ? text.slice(0, length - 1) + "…" : text;
const entry = (e: AuditHistoryEntry): AuditHistoryEntry => ({
  ...e,
  actor: clip(e.actor, 300),
  action: clip(e.action, 300),
  object: clip(e.object, 300),
  reason: e.reason === null ? null : clip(e.reason, 2000),
});

/** How each history's row reads in the viewer. */
export const auditHistoryEntry = {
  access: (row: typeof valoStaffAccessAudit.$inferSelect) =>
    entry({
      id: row.id,
      at: row.createdAt,
      actor: row.actorId,
      action: `Read in ${row.area}`,
      object: row.object,
      reason: row.reason,
    }),
  safety: (row: typeof valoSafetyControlAudit.$inferSelect) =>
    entry({
      id: row.id,
      at: row.createdAt,
      actor: row.actorId,
      action: `${row.area}: ${row.action}`,
      object: row.target,
      reason: row.reason,
    }),
  prices: (row: typeof valoPriceChanges.$inferSelect) =>
    entry({
      id: row.id,
      at: row.changedAt,
      actor: row.changedBy,
      action: PRICE_ACTIONS[row.action] ?? row.action,
      object: `price:${row.priceId}`,
      reason: null,
    }),
  refunds: (row: typeof valoRefundTransitions.$inferSelect) =>
    entry({
      id: row.id,
      at: row.createdAt,
      actor: row.actorId,
      action: row.action,
      object: `refund:${row.refundId}`,
      // The reason may hold a customer's own words, so it stays with finance.
      reason: null,
    }),
  counts: (row: typeof valoHistoryChecks.$inferSelect) =>
    entry({
      id: row.id,
      at: row.checkedAt,
      actor: "worker",
      action:
        row.mismatched.length === 0
          ? "Every history matched its digest"
          : row.mismatched.length === 1
            ? "1 history no longer matched its digest"
            : `${row.mismatched.length} histories no longer matched their digests`,
      object: "histories",
      reason: row.mismatched.length === 0 ? null : row.mismatched.join(", "),
    }),
};

/**
 * One page of a history, for a permanent system operator with recent MFA. The read is itself recorded in
 * the access history, naming the history and the page, before anything is read. Nothing here changes a
 * history.
 */
export async function auditHistory(actor: StaffActor, raw: unknown) {
  const input = GetAuditHistoryQueryParams.strict().parse(raw);
  const kind: AuditHistoryKind = input.kind,
    page = input.page ?? 1,
    offset = (page - 1) * AUDIT_HISTORY_PAGE_SIZE;
  return db.transaction(async (tx) => {
    const authority = await systemAuthority(
      tx,
      actor,
      "A current permanent system assignment is required to read the audit history. Emergency access cannot open it.",
    );
    await tx.insert(valoStaffAccessAudit).values({
      id: randomUUID(),
      assignmentId: authority.id,
      actorId: actor.identityId,
      area: "system",
      object: `audit_history:${kind}`,
      reason: `Read page ${page} of the ${kind} history`,
    });
    const count = async (table: string) =>
      Number(
        (await tx.execute<{ n: string }>(sql`SELECT count(*) AS n FROM ${sql.identifier(table)}`)).rows[0]
          ?.n ?? 0,
      );
    let entries: AuditHistoryEntry[], total: number;
    if (kind === "access") {
      total = await count("valo_staff_access_audit");
      entries = (
        await tx
          .select()
          .from(valoStaffAccessAudit)
          .orderBy(desc(valoStaffAccessAudit.createdAt), desc(valoStaffAccessAudit.id))
          .limit(AUDIT_HISTORY_PAGE_SIZE)
          .offset(offset)
      ).map(auditHistoryEntry.access);
    } else if (kind === "safety") {
      total = await count("valo_safety_control_audit");
      entries = (
        await tx
          .select()
          .from(valoSafetyControlAudit)
          .orderBy(desc(valoSafetyControlAudit.createdAt), desc(valoSafetyControlAudit.id))
          .limit(AUDIT_HISTORY_PAGE_SIZE)
          .offset(offset)
      ).map(auditHistoryEntry.safety);
    } else if (kind === "prices") {
      total = await count("valo_price_changes");
      entries = (
        await tx
          .select()
          .from(valoPriceChanges)
          .orderBy(desc(valoPriceChanges.changedAt), desc(valoPriceChanges.id))
          .limit(AUDIT_HISTORY_PAGE_SIZE)
          .offset(offset)
      ).map(auditHistoryEntry.prices);
    } else if (kind === "refunds") {
      total = await count("valo_refund_transitions");
      entries = (
        await tx
          .select()
          .from(valoRefundTransitions)
          .orderBy(desc(valoRefundTransitions.createdAt), desc(valoRefundTransitions.id))
          .limit(AUDIT_HISTORY_PAGE_SIZE)
          .offset(offset)
      ).map(auditHistoryEntry.refunds);
    } else {
      total = await count("valo_history_checks");
      entries = (
        await tx
          .select()
          .from(valoHistoryChecks)
          .orderBy(desc(valoHistoryChecks.checkedAt), desc(valoHistoryChecks.id))
          .limit(AUDIT_HISTORY_PAGE_SIZE)
          .offset(offset)
      ).map(auditHistoryEntry.counts);
    }
    return { kind, entries, page, pageSize: AUDIT_HISTORY_PAGE_SIZE, total, notice: NOTICES[kind] };
  });
}
