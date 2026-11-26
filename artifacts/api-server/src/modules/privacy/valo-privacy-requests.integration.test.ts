import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { and, eq, inArray, sql } from "drizzle-orm";
import {
  db,
  pool,
  valoConsentChanges,
  valoEvents,
  valoMemberships,
  valoPrivacyCases,
  valoPrivacyEvents,
  valoProfileVersions,
  valoStaffAccessAudit,
  valoStaffAssignments,
  valoSupportActions,
  valoSupportCases,
  valoSupportEscalations,
  valoSupportEvents,
  valoSupportMessages,
  valoSupportTickets,
  valoWorkspaces,
} from "@workspace/db";
import { resolveWorkspace, saveProfile } from "../workspaces";
import { syntheticProfile } from "../../lib/valo-test-fixtures";
import { confirmPrivacyCase, createPrivacyCase, simpleStaffPrivacyAction } from "./valo-privacy";
import { processPrivacyAction } from "./valo-privacy-processing";

const reason = "Synthetic privacy request proof; no customer or provider data.";

// PRV-003: "Provide request verification, correction/export/deletion and legal-hold handling." A hold
// pauses a request, and releasing it returns the request to where it was
// (docs/architecture/privacy-requests.md, slice 1). Before, a partly done data download or correction
// came back "With privacy staff", and no action fitted it.
test(
  "a held request returns to where it was: a partly done data download or correction comes back partly done, with what was done kept",
  { skip: process.env.VALO_RUN_DB_TESTS !== "synthetic-development-only", timeout: 120000 },
  async () => {
    assert.equal(process.env.NODE_ENV, "development");
    assert.ok(!process.env.REPLIT_DEPLOYMENT);
    assert.ok(["localhost", "127.0.0.1", "[::1]"].includes(new URL(process.env.DATABASE_URL!).hostname));
    const owners: string[] = [],
      operators: string[] = [];
    try {
      const staff = {
        identityId: "synthetic-privacy-request-staff-" + randomUUID(),
        recentMfa: true,
        verifiedAt: Date.now(),
      };
      operators.push(staff.identityId);
      await db.insert(valoStaffAssignments).values({
        id: randomUUID(),
        identityId: staff.identityId,
        role: "privacy",
        grantedBy: "synthetic",
        reason,
      });
      /** A request of this kind, confirmed by its owner and claimed by the staff member. */
      const claimed = async (kind: "export" | "correction") => {
        const actor = await resolveWorkspace(`synthetic-privacy-request-${kind}-${randomUUID()}`);
        owners.push(actor.workspaceId);
        if (kind === "correction")
          await saveProfile(actor, { expectedRevision: 0, profile: syntheticProfile });
        const made = await createPrivacyCase(actor, "synthetic@example.invalid", {
          kind,
          idempotencyKey: randomUUID(),
          message: reason,
          acknowledgement: true,
        });
        const id = made.reference.slice(5);
        let detail = await confirmPrivacyCase(actor, id, { expectedVersion: 1, acknowledgement: true });
        detail = await simpleStaffPrivacyAction(staff, id, {
          action: "claim",
          expectedVersion: detail.request.version,
          reason,
        });
        return { actor, id, detail };
      };
      /** Holds the request, releases the hold, and returns the request as it then stands. */
      const heldAndReleased = async (id: string, version: number) => {
        const held = await simpleStaffPrivacyAction(staff, id, {
          action: "hold",
          expectedVersion: version,
          reason,
        });
        assert.equal(held.request.status, "held");
        return simpleStaffPrivacyAction(staff, id, {
          action: "release_hold",
          expectedVersion: held.request.version,
          reason,
        });
      };
      const outcomes = (steps: { system: string; status: string }[]) =>
        Object.fromEntries(steps.map((step) => [step.system, step.status]));

      // A data download, prepared and so partly done.
      const download = await claimed("export");
      const prepared = await processPrivacyAction(staff, download.id, {
        action: "prepare_export",
        expectedVersion: download.detail.request.version,
        reason,
      });
      assert.equal(prepared.request.status, "partially_fulfilled");
      const downloadReleased = await heldAndReleased(download.id, prepared.request.version);
      assert.equal(downloadReleased.request.status, "partially_fulfilled");
      assert.deepEqual(outcomes(downloadReleased.steps), outcomes(prepared.steps));
      const [downloadRow] = await db
        .select()
        .from(valoPrivacyCases)
        .where(eq(valoPrivacyCases.id, download.id));
      assert.ok(downloadRow?.resultJson, "the prepared download is kept");
      assert.equal(downloadRow.resultScope, prepared.request.resultScope);

      // A correction, recorded against a profile saved after the request, and so partly done.
      const correction = await claimed("correction");
      await saveProfile(correction.actor, {
        expectedRevision: 1,
        profile: { ...syntheticProfile, businessName: "Synthetic corrected development business" },
      });
      const [corrected] = await db
        .select({ id: valoProfileVersions.id })
        .from(valoProfileVersions)
        .where(
          and(
            eq(valoProfileVersions.workspaceId, correction.actor.workspaceId),
            eq(valoProfileVersions.revision, 2),
          ),
        );
      const recorded = await processPrivacyAction(staff, correction.id, {
        action: "record_correction",
        expectedVersion: correction.detail.request.version,
        reason,
        profileVersionId: corrected!.id,
        acknowledgement: true,
      });
      assert.equal(recorded.request.status, "partially_fulfilled");
      const correctionReleased = await heldAndReleased(correction.id, recorded.request.version);
      assert.equal(correctionReleased.request.status, "partially_fulfilled");
      assert.deepEqual(outcomes(correctionReleased.steps), outcomes(recorded.steps));

      // A request held before anything was done comes back to its staff member, as before.
      const untouched = await claimed("export");
      const untouchedReleased = await heldAndReleased(untouched.id, untouched.detail.request.version);
      assert.equal(untouchedReleased.request.status, "assigned");
    } finally {
      await db.transaction(async (tx) => {
        await tx.execute(sql`SET LOCAL session_replication_role=replica`);
        // Replica mode skips foreign key cascades, so a ticket's support case and its history are
        // removed explicitly; case history is reached through its case.
        const cases = tx
          .select({ id: valoSupportCases.id })
          .from(valoSupportCases)
          .where(inArray(valoSupportCases.workspaceId, owners));
        for (const table of [valoSupportActions, valoSupportEvents, valoSupportEscalations])
          await tx.delete(table).where(inArray(table.caseId, cases));
        for (const table of [
          valoPrivacyEvents,
          valoPrivacyCases,
          valoSupportMessages,
          valoSupportCases,
          valoSupportTickets,
          valoProfileVersions,
          valoConsentChanges,
          valoEvents,
          valoMemberships,
        ])
          await tx.delete(table).where(inArray(table.workspaceId, owners));
        await tx.delete(valoWorkspaces).where(inArray(valoWorkspaces.id, owners));
        await tx.delete(valoStaffAccessAudit).where(inArray(valoStaffAccessAudit.actorId, operators));
        await tx.delete(valoStaffAssignments).where(inArray(valoStaffAssignments.identityId, operators));
      });
      await pool.end();
    }
  },
);
