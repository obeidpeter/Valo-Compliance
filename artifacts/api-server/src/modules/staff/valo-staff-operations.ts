import { randomUUID } from "node:crypto";
import { and, desc, eq, sql } from "drizzle-orm";
import {
  db,
  valoAccessSupport,
  valoContentVersions,
  valoOrders,
  valoPreparedCandidates,
  valoPaymentReconciliations,
  valoRefundRequests,
  valoSafetySwitches,
  valoStaffAccessAudit,
  valoStaffAssignments,
  valoSupportTickets,
} from "@workspace/db";
import { ValoProblem } from "../../platform/valo-problem";
import {
  activeStaffAssignment,
  assertStaffAssignmentCurrent,
  requireFreshStaffSession,
  type StaffActor,
} from "./valo-staff-authority";

export type StaffArea = "content" | "support" | "finance" | "system";

export type PreparedCandidateState = "awaiting_reviews" | "saved" | "expired" | "version_taken";
/**
 * Where a prepared template candidate stands (decision 0014). It is saved once a version exists
 * under its ID; before that, another candidate saved under its version number, or a passed review
 * date, ends its review, and it must be prepared again.
 */
export function preparedCandidateState(
  candidate: { reviewBy: Date; savedStatus: string | null; versionTaken: boolean },
  now: Date,
): PreparedCandidateState {
  if (candidate.savedStatus) return "saved";
  if (candidate.versionTaken) return "version_taken";
  if (+candidate.reviewBy <= +now) return "expired";
  return "awaiting_reviews";
}
type SavedStatus = "candidate" | "held" | "published" | "withdrawn";
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
    let preparedCandidates:
      | {
          artifactId: string;
          artifactHash: string;
          versionId: string;
          templateId: string;
          version: number;
          preparedAt: Date;
          reviewBy: Date;
          state: PreparedCandidateState;
          savedStatus: SavedStatus | null;
        }[]
      | undefined;
    if (area === "content") {
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
        .orderBy(valoContentVersions.templateId, desc(valoContentVersions.version))
        .limit(200);
      // A candidate awaiting its reviews is a private artifact, not a content version, so it is
      // listed from its own record with where it stands.
      const now = new Date();
      const prepared = await tx
        .select({
          artifactId: valoPreparedCandidates.artifactId,
          artifactHash: valoPreparedCandidates.artifactHash,
          versionId: valoPreparedCandidates.versionId,
          templateId: valoPreparedCandidates.templateId,
          version: valoPreparedCandidates.version,
          preparedAt: valoPreparedCandidates.preparedAt,
          reviewBy: valoPreparedCandidates.reviewBy,
          savedStatus: valoContentVersions.status,
          versionTaken: sql<boolean>`exists(select 1 from valo_content_versions t
            where t.template_id = ${valoPreparedCandidates.templateId}
            and t.version = ${valoPreparedCandidates.version} and t.id <> ${valoPreparedCandidates.versionId})`,
        })
        .from(valoPreparedCandidates)
        .leftJoin(valoContentVersions, eq(valoContentVersions.id, valoPreparedCandidates.versionId))
        .orderBy(desc(valoPreparedCandidates.preparedAt))
        .limit(100);
      preparedCandidates = prepared.map(({ versionTaken, savedStatus, ...r }) => ({
        ...r,
        state: preparedCandidateState({ reviewBy: r.reviewBy, savedStatus, versionTaken }, now),
        savedStatus: savedStatus as SavedStatus | null,
      }));
    }
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
    return { area, notice, records, ...(preparedCandidates ? { preparedCandidates } : {}) };
  });
}
