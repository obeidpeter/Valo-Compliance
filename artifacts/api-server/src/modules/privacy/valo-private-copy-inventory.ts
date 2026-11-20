import { sql } from "drizzle-orm";
import { db } from "@workspace/db";
import {
  removedPrivateText,
  erasureProgressReason,
  redactAuditReason,
  redactDisputeAction,
} from "./valo-privacy-redactions";
import { cancelUnsentDisputeWork } from "../commerce";
import { ValoProblem } from "../../platform/valo-problem";
type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
export const copyPhases = [
  "financial_contact",
  "refund_text",
  "refund_history",
  "dispute_text",
  "payment_event_text",
  "activity_text",
  "privacy_audit_text",
] as const;
export type CopyPhase = (typeof copyPhases)[number];
/** Reference ownership is evaluated while the connecting financial records are
 * still present. An email or an untrusted webhook body never establishes it. */
export function ownedPaymentEvent(workspaceId: string) {
  return sql`reference IN (
    SELECT reference FROM valo_orders WHERE workspace_id=${workspaceId}::uuid
    UNION SELECT provider_transaction_id FROM valo_orders WHERE workspace_id=${workspaceId}::uuid
    UNION SELECT reference FROM valo_refund_requests WHERE workspace_id=${workspaceId}::uuid
    UNION SELECT provider_id FROM valo_refund_requests WHERE workspace_id=${workspaceId}::uuid
    UNION SELECT provider_id FROM valo_payment_disputes WHERE workspace_id=${workspaceId}::uuid)`;
}
export async function fencePrivateCopies(tx: Tx, workspaceId: string) {
  const installed = await tx.execute<{ installed: string | null }>(
    sql`SELECT to_regclass('valo_jobs.job')::text AS installed`,
  );
  if (!installed.rows[0]?.installed)
    throw new ValoProblem(
      409,
      "Durable queue inventory is unavailable. Apply the reviewed development queue setup before erasure; no cleanup has completed.",
    );
  await cancelUnsentDisputeWork(tx, workspaceId);
  const linked = sql`EXISTS(SELECT 1 FROM valo_export_jobs j
    WHERE j.workspace_id=${workspaceId}::uuid AND j.queue_id=q.id)`;
  const candidate = sql`(q.data->>'workspaceId'=${workspaceId} OR ${linked})`;
  const conflict = await tx.execute(sql`SELECT q.id FROM valo_jobs.job q WHERE q.name='valo-manual-export-v1'
    AND ${candidate} AND(EXISTS(SELECT 1 FROM valo_export_jobs j
      WHERE j.workspace_id<>${workspaceId}::uuid AND j.queue_id=q.id)
      OR(${linked} AND q.data->>'workspaceId' IS NOT NULL AND q.data->>'workspaceId'<>${workspaceId})) LIMIT 1`);
  if (conflict.rows.length)
    throw new ValoProblem(
      409,
      "Queue ownership is inconsistent. Erasure is held for scoped review; no queued payload was deleted.",
    );
  // Both older payloads lacking a tenant field and orphaned payloads whose
  // tracking row is already absent need cleanup. Either trustworthy link is
  // sufficient only after conflicting ownership has been excluded.
  await tx.execute(sql`DELETE FROM valo_jobs.job q WHERE q.name='valo-manual-export-v1' AND ${candidate}`);
  await tx.execute(sql`UPDATE valo_refund_requests SET status='needs_review',failure='PRIVACY_ERASURE_FINANCE_REVIEW',
    lease_token=NULL,lease_until=NULL,next_attempt_at=NULL
    WHERE workspace_id=${workspaceId}::uuid AND status IN('approved','submitting','sending','dispatching','pending','unknown')`);
  await tx.execute(sql`UPDATE valo_payment_events SET status='needs_review',failure='PRIVACY_ERASURE_FINANCE_REVIEW'
    WHERE ${ownedPaymentEvent(workspaceId)} AND status='pending'`);
}
export async function erasePrivateCopyPhase(
  tx: Tx,
  workspaceId: string,
  phase: CopyPhase,
  verifyCase: (id: string) => Promise<unknown>,
) {
  if (phase === "financial_contact")
    return tx.execute(sql`UPDATE valo_orders SET requested_by='privacy-erased',checkout_url=NULL
    WHERE id IN(SELECT id FROM valo_orders WHERE workspace_id=${workspaceId}::uuid
      AND(requested_by<>'privacy-erased' OR checkout_url IS NOT NULL) LIMIT 100)`);
  if (phase === "refund_text")
    return tx.execute(sql`UPDATE valo_refund_requests SET reason=${removedPrivateText},
    decision_reason=CASE WHEN decision_reason IS NULL THEN NULL ELSE ${removedPrivateText} END,
    failure=CASE WHEN failure IS NULL THEN NULL ELSE 'PRIVACY_ERASURE_FINANCE_REVIEW' END
    WHERE id IN(SELECT id FROM valo_refund_requests WHERE workspace_id=${workspaceId}::uuid
      AND(reason<>${removedPrivateText} OR decision_reason IS NOT NULL AND decision_reason<>${removedPrivateText}
        OR failure IS NOT NULL AND failure<>'PRIVACY_ERASURE_FINANCE_REVIEW') LIMIT 100)`);
  if (phase === "refund_history" || phase === "privacy_audit_text") {
    const table = phase === "refund_history" ? "valo_refund_transitions" : "valo_privacy_events";
    const rows = await tx.execute<{
      record: { id: string; workspace_id: string; reason: string; [key: string]: unknown };
    }>(sql`
      SELECT to_jsonb(t) AS record FROM ${sql.identifier(table)} t WHERE workspace_id=${workspaceId}::uuid
      AND reason<>${removedPrivateText} AND reason<>${erasureProgressReason} ORDER BY id LIMIT 100 FOR UPDATE`);
    const checked = new Set<string>();
    for (const { record } of rows.rows) {
      if (table === "valo_privacy_events") {
        const caseId = String(record.case_id);
        if (!checked.has(caseId)) {
          await verifyCase(caseId);
          checked.add(caseId);
        }
      }
      await redactAuditReason(tx, table, record);
    }
    return { rowCount: rows.rows.length };
  }
  if (phase === "activity_text")
    return tx.execute(sql`DELETE FROM valo_events WHERE id IN
    (SELECT id FROM valo_events WHERE workspace_id=${workspaceId}::uuid LIMIT 100)`);
  if (phase === "payment_event_text")
    return tx.execute(sql`UPDATE valo_payment_events SET failure='PRIVACY_ERASURE_FINANCE_REVIEW'
    WHERE id IN(SELECT id FROM valo_payment_events WHERE ${ownedPaymentEvent(workspaceId)}
      AND failure IS NOT NULL AND failure<>'PRIVACY_ERASURE_FINANCE_REVIEW' LIMIT 100)`);
  // Keep monetary decision facts, not copied statements, filenames or signed URLs.
  const information = await tx.execute(sql`UPDATE valo_dispute_information SET information='{}'::jsonb
    WHERE id IN(SELECT id FROM valo_dispute_information WHERE workspace_id=${workspaceId}::uuid
      AND information<>'{}'::jsonb LIMIT 100)`);
  const actions = await tx.execute<{
    record: { id: string; workspace_id: string; [key: string]: unknown };
  }>(sql`
    SELECT to_jsonb(a) AS record FROM valo_dispute_actions a WHERE workspace_id=${workspaceId}::uuid
      AND(result IS NOT NULL OR failure IS DISTINCT FROM 'PRIVACY_ERASURE' OR EXISTS(
        SELECT 1 FROM jsonb_each(payload) WHERE NOT(key IN('amount','amountKobo','refund_amount','refundAmountKobo')
          AND jsonb_typeof(value)='number' AND value::text ~ '^[0-9]+$'))) ORDER BY id LIMIT 100 FOR UPDATE`);
  for (const { record } of actions.rows) await redactDisputeAction(tx, record);
  const reconciliation =
    await tx.execute(sql`UPDATE valo_payment_reconciliations SET finding='PRIVACY_ERASURE_FINANCE_REVIEW'
    WHERE id IN(SELECT id FROM valo_payment_reconciliations WHERE workspace_id=${workspaceId}::uuid
      AND finding IS NOT NULL AND finding<>'PRIVACY_ERASURE_FINANCE_REVIEW' LIMIT 100)`);
  return { rowCount: Math.max(information.rowCount ?? 0, actions.rows.length, reconciliation.rowCount ?? 0) };
}
