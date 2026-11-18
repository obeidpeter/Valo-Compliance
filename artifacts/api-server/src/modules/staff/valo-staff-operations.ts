import { randomUUID } from "node:crypto";
import { and, desc, eq } from "drizzle-orm";
import {
  db,
  valoAccessSupport,
  valoContentVersions,
  valoOrders,
  valoPaymentReconciliations,
  valoRefundRequests,
  valoSafetySwitches,
  valoStaffAccessAudit,
  valoStaffAssignments,
  valoSupportTickets,
} from "@workspace/db";
import { ValoProblem } from "../../lib/valo-problem";
import {
  activeStaffAssignment,
  assertStaffAssignmentCurrent,
  requireFreshStaffSession,
  type StaffActor,
} from "./valo-staff-authority";

export type StaffArea = "content" | "support" | "finance" | "system";
export async function staffOperations(actor: StaffActor, area: StaffArea) {
  requireFreshStaffSession(actor);
  const { identityId } = actor;
  return db.transaction(async (tx) => {
    const [assignment] = await tx
      .select()
      .from(valoStaffAssignments)
      .where(
        and(
          eq(valoStaffAssignments.identityId, identityId),
          eq(valoStaffAssignments.role, area),
          activeStaffAssignment(),
        ),
      )
      .for("share");
    if (!assignment)
      throw new ValoProblem(
        403,
        "This account has no active permission for this staff area. Customer sign-in does not grant staff access.",
      );
    await assertStaffAssignmentCurrent(tx, assignment.id);
    requireFreshStaffSession(actor);
    await tx.insert(valoStaffAccessAudit).values({
      id: randomUUID(),
      assignmentId: assignment.id,
      actorId: identityId,
      area,
      reason: "Read-only operational access after active role and recent MFA checks",
    });
    let records: Record<string, unknown>[] = [];
    let notice =
      "Operational overview. Source/version safety controls are separate, require recent MFA and an active role, and cannot approve publication, spending or customer-document changes.";
    if (area === "content")
      records = await tx
        .select({
          id: valoContentVersions.id,
          templateId: valoContentVersions.templateId,
          slug: valoContentVersions.slug,
          version: valoContentVersions.version,
          status: valoContentVersions.status,
          reviewBy: valoContentVersions.reviewBy,
        })
        .from(valoContentVersions)
        .limit(200);
    if (area === "support") {
      const intake = await tx
        .select()
        .from(valoAccessSupport)
        .orderBy(desc(valoAccessSupport.createdAt))
        .limit(100);
      const privateTickets = await tx
        .select()
        .from(valoSupportTickets)
        .orderBy(desc(valoSupportTickets.createdAt))
        .limit(100);
      records = [
        ...intake.map((r) => ({ ...r, kind: "public_access_request" })),
        ...privateTickets.map((r) => ({ ...r, kind: "workspace_request" })),
      ];
      // Intake idempotency and payload hashes are not needed by staff.
      records = records.map(({ payloadHash, idempotencyKey, ...r }) => r);
    }
    if (area === "finance") {
      const orders = await tx
        .select({
          id: valoOrders.id,
          reference: valoOrders.reference,
          amountKobo: valoOrders.amountKobo,
          currency: valoOrders.currency,
          status: valoOrders.status,
          lastCheckedAt: valoOrders.lastCheckedAt,
        })
        .from(valoOrders)
        .orderBy(desc(valoOrders.createdAt))
        .limit(100);
      const refunds = await tx
        .select({
          id: valoRefundRequests.id,
          orderId: valoRefundRequests.orderId,
          status: valoRefundRequests.status,
          createdAt: valoRefundRequests.createdAt,
        })
        .from(valoRefundRequests)
        .orderBy(desc(valoRefundRequests.createdAt))
        .limit(100);
      const reconciliation = await tx
        .select()
        .from(valoPaymentReconciliations)
        .orderBy(desc(valoPaymentReconciliations.createdAt))
        .limit(100);
      records = [
        ...orders.map((r) => ({ ...r, kind: "test_order" })),
        ...refunds.map((r) => ({ ...r, kind: "refund_request" })),
        ...reconciliation.map((r) => ({ ...r, kind: "daily_reconciliation" })),
      ];
      notice =
        "Test-mode financial records only. Refund requests are not completed refunds. This role cannot read document bodies, edit financial history or grant entitlement directly. Provider execution remains dependent on test-merchant setup.";
    }
    if (area === "system") records = await tx.select().from(valoSafetySwitches).limit(100);
    return { area, notice, records };
  });
}
