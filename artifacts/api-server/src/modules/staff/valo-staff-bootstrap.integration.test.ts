import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { db, pool, valoStaffAssignments, valoStaffRoleChanges } from "@workspace/db";
import {
  bootstrapFirstSystemAdministrator,
  bootstrapFirstSystemAdministratorIn,
  type StaffTarget,
} from "./valo-staff-roles";
import { activeStaffAssignment } from "./valo-staff-authority";
import { ValoProblem } from "../../lib/valo-problem";

const rollback = Symbol("rollback");
type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
async function inRollback(fn: (tx: Tx) => Promise<void>) {
  try {
    await db.transaction(async (tx) => {
      await fn(tx);
      // oxlint-disable-next-line typescript/only-throw-error -- a sentinel that rolls the transaction back; caught just below
      throw rollback;
    });
  } catch (error) {
    if (error !== rollback) throw error;
  }
}
const verified = (id: string, overrides: Partial<StaffTarget> = {}): StaffTarget => ({
  id,
  label: `${id}@example.invalid`,
  banned: false,
  locked: false,
  verifiedPrimary: true,
  verifiedAt: Date.now(),
  ...overrides,
});
const reason = "Synthetic first administrator bootstrap test only";

test(
  "first administrator bootstrap is audited, single-use and never persists in this suite",
  { skip: process.env.VALO_RUN_STAFF_ROLE_TESTS !== "synthetic-development-only", timeout: 30000 },
  async (t) => {
    try {
      await t.test("creates one permanent administrator with an immutable role change, then refuses", () =>
        inRollback(async (tx) => {
          // Inside the rolled-back transaction only: start from a database with no administrator.
          await tx
            .update(valoStaffAssignments)
            .set({ active: false })
            .where(eq(valoStaffAssignments.role, "system"));
          const id = `user_synthetic_bootstrap_${randomUUID().replaceAll("-", "")}`;
          const receipt = await bootstrapFirstSystemAdministratorIn(
            tx,
            { identityId: id, operator: "ci-test", reason },
            verified(id),
          );
          assert.equal(receipt.action, "grant");
          assert.equal(receipt.role, "system");
          const [assignment] = await tx
            .select()
            .from(valoStaffAssignments)
            .where(
              and(
                eq(valoStaffAssignments.identityId, id),
                eq(valoStaffAssignments.role, "system"),
                activeStaffAssignment(),
              ),
            );
          assert.equal(assignment?.grantMode, "permanent");
          assert.equal(assignment?.expiresAt, null);
          const [change] = await tx
            .select()
            .from(valoStaffRoleChanges)
            .where(eq(valoStaffRoleChanges.assignmentId, assignment!.id));
          assert.equal(change?.actorId, "operator-bootstrap:ci-test");
          assert.equal(change?.actorAssignmentId, assignment!.id);
          const second = `user_synthetic_bootstrap_${randomUUID().replaceAll("-", "")}`;
          await assert.rejects(
            bootstrapFirstSystemAdministratorIn(
              tx,
              { identityId: second, operator: "ci-test", reason },
              verified(second),
            ),
            (error) => error instanceof ValoProblem && error.status === 409,
          );
        }),
      );
      await t.test("refuses malformed input and accounts that are not active and verified", async () => {
        const id = `user_synthetic_bootstrap_${randomUUID().replaceAll("-", "")}`;
        const refused = (error: unknown, status: number) =>
          error instanceof ValoProblem && error.status === status;
        await assert.rejects(
          bootstrapFirstSystemAdministrator(
            { identityId: "not-a-user", operator: "ci-test", reason },
            async () => verified(id),
          ),
          (e) => refused(e, 422),
        );
        await assert.rejects(
          bootstrapFirstSystemAdministrator({ identityId: id, operator: "x", reason }, async () =>
            verified(id),
          ),
          (e) => refused(e, 422),
        );
        await assert.rejects(
          bootstrapFirstSystemAdministrator(
            { identityId: id, operator: "ci-test", reason: "too short" },
            async () => verified(id),
          ),
          (e) => refused(e, 422),
        );
        for (const overrides of [{ banned: true }, { locked: true }, { verifiedPrimary: false }])
          await assert.rejects(
            bootstrapFirstSystemAdministrator({ identityId: id, operator: "ci-test", reason }, async () =>
              verified(id, overrides),
            ),
            (e) => refused(e, 403),
          );
        const [persisted] = await db
          .select()
          .from(valoStaffAssignments)
          .where(eq(valoStaffAssignments.identityId, id));
        assert.equal(persisted, undefined);
      });
    } finally {
      await pool.end();
    }
  },
);
