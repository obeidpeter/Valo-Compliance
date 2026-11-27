import { and, eq, sql } from "drizzle-orm";
import type { db } from "@workspace/db";
import { ValoProblem } from "../../platform/valo-problem";
import { assertDevelopmentRuntime } from "../../platform/valo-development-runtime";
import {
  activeStaffAssignment,
  assertStaffAssignmentCurrent,
  requireFreshStaffSession,
  type StaffActor,
} from "./valo-staff-authority";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/**
 * Runs `work` in a transaction as the designated development owner: development only, a sign-in
 * verified moments ago, an active permanent system role, and the owner the operator bootstrap named
 * (`valo_manual_regulatory_owner`). The owner signs regulatory articles (decision 0018) and
 * requirements-checker rules (decision 0020) this way.
 */
export async function asDevelopmentOwner<T>(
  actor: StaffActor,
  work: (tx: Tx) => Promise<T>,
  refusal = "Only the designated development owner can sign regulatory guidance.",
) {
  assertDevelopmentRuntime();
  requireFreshStaffSession(actor);
  const { db: store, valoStaffAssignments: a } = await import("@workspace/db");
  return store.transaction(async (tx) => {
    const [role] = await tx
      .select({ id: a.id })
      .from(a)
      .where(
        and(
          eq(a.identityId, actor.identityId),
          eq(a.role, "system"),
          eq(a.grantMode, "permanent"),
          activeStaffAssignment(),
        ),
      )
      .for("share");
    if (!role)
      throw new ValoProblem(403, "A permanent development owner with recent verification is required.");
    await assertStaffAssignmentCurrent(tx, role.id);
    const owner = await tx.execute(sql`select valo_manual_regulatory_owner(${actor.identityId}) as allowed`);
    if (!owner.rows[0]?.allowed) throw new ValoProblem(403, refusal);
    return work(tx);
  });
}
