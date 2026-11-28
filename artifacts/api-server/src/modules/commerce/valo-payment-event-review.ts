import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { db, valoPaymentEventSettlements } from "@workspace/db";
import { SettleFinancePaymentEventBody } from "@workspace/api-zod";
import { ValoProblem } from "../../platform/valo-problem";
import { requireFinance, type FinanceActor } from "./valo-refunds";

/**
 * A provider event the event worker left for finance, that no settlement covers with the finding it has now
 * (docs/architecture/reconciliation.md, slice 3a). The operations reading `unmatchedPaymentEvents` counts the
 * same rows, and a test holds the two together. An event whose finding changes, as an erasure's does, waits
 * again.
 */
const waiting = sql`e.status = 'needs_review' AND NOT EXISTS (SELECT 1 FROM valo_payment_event_settlements s
  WHERE s.event_id = e.id AND s.finding = coalesce(e.failure, ''))`;
type EventRow = {
  id: string;
  event_type: string;
  reference: string | null;
  created_at: Date | string;
  finding: string;
  attempts: number;
  resolved_at: Date | string | null;
  resolved_by: string | null;
  reason: string | null;
};
function eventView(actor: FinanceActor, row: EventRow) {
  return {
    id: row.id,
    eventType: row.event_type,
    reference: row.reference,
    receivedAt: new Date(row.created_at).toISOString(),
    finding: row.finding,
    attempts: row.attempts,
    resolvedAt: row.resolved_at === null ? null : new Date(row.resolved_at).toISOString(),
    resolvedByYou: row.resolved_by === actor.identityId,
    reason: row.reason,
  };
}
const SETTLEMENT_REASON = /^Payment event [0-9a-f-]{36}: /;

/** Finance's view of the provider's events Valo could not match or process: those waiting, and the latest
 * settlements with who made them and why (PAY-007). */
export async function financePaymentEvents(actor: FinanceActor) {
  return db.transaction(async (tx) => {
    await requireFinance(
      tx,
      actor,
      "Read the Paystack events waiting for finance and their settlements; no private document bodies.",
      "payment_events",
    );
    const waitingRows = await tx.execute<EventRow>(sql`SELECT e.id, e.event_type, e.reference, e.created_at,
        coalesce(e.failure, '') AS finding, e.attempts, NULL::timestamptz AS resolved_at,
        NULL::text AS resolved_by, NULL::text AS reason
      FROM valo_payment_events e WHERE ${waiting} ORDER BY e.created_at DESC, e.id LIMIT 100`);
    const settled = await tx.execute<EventRow>(sql`SELECT e.id, e.event_type, e.reference, e.created_at,
        s.finding, e.attempts, s.resolved_at, s.resolved_by,
        (SELECT a.reason FROM valo_staff_access_audit a WHERE a.object = 'payment_event:' || e.id::text
          AND a.actor_id = s.resolved_by AND a.created_at = s.resolved_at ORDER BY a.id LIMIT 1) AS reason
      FROM valo_payment_event_settlements s JOIN valo_payment_events e ON e.id = s.event_id
      ORDER BY s.resolved_at DESC, s.id LIMIT 50`);
    return {
      waiting: waitingRows.rows.map((row) => eventView(actor, row)),
      settled: settled.rows.map((row) =>
        eventView(actor, { ...row, reason: row.reason?.replace(SETTLEMENT_REASON, "") ?? null }),
      ),
    };
  });
}

/**
 * Finance records what it found about a provider event Valo could not match or process
 * (docs/architecture/reconciliation.md, slice 3a). A settlement is a row of its own, for the event and the
 * finding it has, and the reason is kept in the staff access audit, in one transaction. The event itself, and
 * every order, payment and grant, is left as it was. The database's guard `valo_payment_event_settlements_kept`
 * refuses a settlement made any other way.
 */
export async function settlePaymentEvent(actor: FinanceActor, id: string, raw: unknown) {
  const input = SettleFinancePaymentEventBody.strict().parse(raw);
  return db.transaction(async (tx) => {
    const [event] = await tx
      .execute<{ id: string; finding: string }>(
        sql`SELECT e.id, coalesce(e.failure, '') AS finding FROM valo_payment_events e
      WHERE e.id = ${id}::uuid FOR UPDATE`,
      )
      .then((result) => result.rows);
    if (!event) throw new ValoProblem(404, "Payment event not found.");
    await requireFinance(tx, actor, `Payment event ${id}: ${input.reason}`, `payment_event:${id}`);
    const [open] = await tx
      .execute<{ id: string }>(
        sql`SELECT e.id FROM valo_payment_events e WHERE e.id = ${id}::uuid AND ${waiting}`,
      )
      .then((result) => result.rows);
    if (!open)
      throw new ValoProblem(
        409,
        "This event is not waiting for finance: it has been settled, or Valo has processed it. Refresh the list.",
      );
    await tx.insert(valoPaymentEventSettlements).values({
      id: randomUUID(),
      eventId: id,
      finding: event.finding,
      resolvedBy: actor.identityId,
      resolvedAt: sql`now()`,
    });
    const [row] = await tx
      .execute<EventRow>(
        sql`SELECT e.id, e.event_type, e.reference, e.created_at, s.finding, e.attempts, s.resolved_at,
        s.resolved_by, ${input.reason}::text AS reason
      FROM valo_payment_event_settlements s JOIN valo_payment_events e ON e.id = s.event_id
      WHERE s.event_id = ${id}::uuid AND s.finding = ${event.finding}`,
      )
      .then((result) => result.rows);
    return eventView(actor, row!);
  });
}
