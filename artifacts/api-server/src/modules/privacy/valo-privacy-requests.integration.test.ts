import { after, test } from "node:test";
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
  valoPrivacyErasureObjects,
  valoPrivacyEvents,
  valoPrivacyTombstones,
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
import {
  confirmPrivacyCase,
  createPrivacyCase,
  simpleStaffPrivacyAction,
  staffPrivacyDetail,
} from "./valo-privacy";
import { privacyPreparedResult, processPrivacyAction } from "./valo-privacy-processing";
import { closePrivacyErasureLocks, processPrivacyErasure } from "./valo-privacy-erasure";

const reason = "Synthetic privacy request proof; no customer or provider data.";
const skip = process.env.VALO_RUN_DB_TESTS !== "synthetic-development-only";
const owners: string[] = [],
  operators: string[] = [];

/** These tests write synthetic rows to a local development database, and nowhere else. */
function assertSyntheticDatabase() {
  assert.equal(process.env.NODE_ENV, "development");
  assert.ok(!process.env.REPLIT_DEPLOYMENT);
  assert.ok(["localhost", "127.0.0.1", "[::1]"].includes(new URL(process.env.DATABASE_URL!).hostname));
}

/** A member of privacy staff, with fresh multi-factor verification. */
async function privacyStaff() {
  const member = {
    identityId: "synthetic-privacy-request-staff-" + randomUUID(),
    recentMfa: true,
    verifiedAt: Date.now(),
  };
  operators.push(member.identityId);
  await db.insert(valoStaffAssignments).values({
    id: randomUUID(),
    identityId: member.identityId,
    role: "privacy",
    grantedBy: "synthetic",
    reason,
  });
  return member;
}

/** A request of this kind, confirmed by its owner and claimed by the staff member. */
async function claimed(
  kind: "export" | "correction" | "deletion",
  staff: Awaited<ReturnType<typeof privacyStaff>>,
) {
  const actor = await resolveWorkspace(`synthetic-privacy-request-${kind}-${randomUUID()}`);
  owners.push(actor.workspaceId);
  if (kind === "correction") await saveProfile(actor, { expectedRevision: 0, profile: syntheticProfile });
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
}

/** Each step's outcome, by its place. */
const outcomes = (steps: { system: string; status: string }[]) =>
  Object.fromEntries(steps.map((step) => [step.system, step.status]));

after(async () => {
  if (skip) return;
  await db.transaction(async (tx) => {
    await tx.execute(sql`SET LOCAL session_replication_role=replica`);
    // Replica mode skips foreign key cascades, so a ticket's support case and its history are removed
    // explicitly; case history is reached through its case.
    const cases = tx
      .select({ id: valoSupportCases.id })
      .from(valoSupportCases)
      .where(inArray(valoSupportCases.workspaceId, owners));
    for (const table of [valoSupportActions, valoSupportEvents, valoSupportEscalations])
      await tx.delete(table).where(inArray(table.caseId, cases));
    for (const table of [
      valoPrivacyErasureObjects,
      valoPrivacyEvents,
      valoPrivacyTombstones,
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
  await closePrivacyErasureLocks();
  await pool.end();
});

// PRV-003: "Provide request verification, correction/export/deletion and legal-hold handling." A hold
// pauses a request, and releasing it returns the request to where it was
// (docs/architecture/privacy-requests.md, slice 1). Before, a partly done data download or correction
// came back "With privacy staff", and no action fitted it.
test(
  "a held request returns to where it was: a partly done data download or correction comes back partly done, with what was done kept",
  { skip, timeout: 120000 },
  async () => {
    assertSyntheticDatabase();
    const staff = await privacyStaff();
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

    // A data download, prepared and so partly done.
    const download = await claimed("export", staff);
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
    const correction = await claimed("correction", staff);
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
    const untouched = await claimed("export", staff);
    const untouchedReleased = await heldAndReleased(untouched.id, untouched.detail.request.version);
    assert.equal(untouchedReleased.request.status, "assigned");
  },
);

// PRV-003: "Accept: a test request traverses all systems." Staff record each of the four steps outside
// Valo's own rows from what they did there, and mark the request done once every step is confirmed or
// not needed (docs/architecture/privacy-requests.md, slice 2).
test(
  "a test request traverses every step: a synthetic deletion is confirmed, claimed and erased, its four outside steps are recorded by its own staff member, and it is marked done, after which nothing changes it",
  { skip, timeout: 180000 },
  async () => {
    assertSyntheticDatabase();
    const staff = await privacyStaff(),
      other = await privacyStaff();
    const deletion = await claimed("deletion", staff);
    const erase = (action: "start_erasure" | "resume_erasure", expectedVersion: number) =>
      processPrivacyErasure(
        staff,
        deletion.id,
        { action, expectedVersion, reason, acknowledgement: true },
        // The synthetic workspace holds no files, so nothing is removed from storage.
        async () => {},
      );
    let detail = await erase("start_erasure", deletion.detail.request.version);
    for (let n = 0; n < 80 && detail.request.status !== "partially_fulfilled"; n++)
      detail = await erase("resume_erasure", detail.request.version);
    assert.equal(detail.request.status, "partially_fulfilled");
    assert.deepEqual(
      [
        outcomes(detail.steps).application,
        ...["private_files", "managed_identity", "external_processors", "retention_and_recovery"].map(
          (system) => outcomes(detail.steps)[system],
        ),
      ],
      ["confirmed", "held", "held", "held", "held"],
    );
    let staffView = await staffPrivacyDetail(staff, deletion.id);
    assert.ok(staffView.availableActions.includes("record_step"));
    assert.ok(!staffView.availableActions.includes("complete"));
    assert.deepEqual((await staffPrivacyDetail(other, deletion.id)).availableActions, []);

    const act = (by: typeof staff, input: Record<string, unknown>) =>
      processPrivacyAction(by, deletion.id, { expectedVersion: detail.request.version, reason, ...input });
    // Not done while a step is held.
    await assert.rejects(act(staff, { action: "complete" }), { status: 409 });
    // Only its own staff member records a step, and only one of the four outside steps, with its outcome.
    await assert.rejects(
      act(other, { action: "record_step", system: "private_files", outcome: "confirmed" }),
      {
        status: 403,
      },
    );
    await assert.rejects(act(staff, { action: "record_step", system: "application", outcome: "confirmed" }));
    await assert.rejects(act(staff, { action: "record_step", system: "private_files" }), { status: 422 });

    const recorded = {
      private_files: ["confirmed", "Synthetic: the erasure's list of files was empty, so no file was held."],
      managed_identity: ["confirmed", "Synthetic: the sign-in account was removed at the sign-in service."],
      external_processors: ["not_applicable", "Synthetic: no outside service held this workspace's data."],
      retention_and_recovery: ["confirmed", "Synthetic: nothing is kept; older backups expire on their own."],
    } as const;
    for (const [system, [outcome, words]] of Object.entries(recorded)) {
      detail = await act(staff, { action: "record_step", system, outcome, reason: words });
      assert.equal(detail.request.status, "partially_fulfilled");
    }
    // A step can be recorded again, with its reason, until the request is done.
    const again = "Synthetic: checked again; no outside service held this workspace's data.";
    detail = await act(staff, {
      action: "record_step",
      system: "external_processors",
      outcome: "not_applicable",
      reason: again,
    });
    staffView = await staffPrivacyDetail(staff, deletion.id);
    assert.ok(staffView.availableActions.includes("complete"));

    detail = await act(staff, { action: "complete", reason: "Synthetic: every step is recorded." });
    assert.equal(detail.request.status, "fulfilled");
    assert.equal(
      detail.request.resultScope,
      "This request is done. Each step says what was done there, or why it was not needed.",
    );
    const finished = Object.fromEntries(
      detail.steps.map((step) => [step.system, [step.status, step.detail]]),
    );
    assert.deepEqual(finished.managed_identity, [...recorded.managed_identity]);
    assert.deepEqual(finished.external_processors, ["not_applicable", again]);
    assert.equal(finished.application?.[0], "confirmed");
    assert.equal(finished.identity_verification?.[0], "confirmed");

    // The signed history holds each record, and still verifies when it is read.
    staffView = await staffPrivacyDetail(staff, deletion.id);
    const history = staffView.events.map((event) => event.action);
    assert.equal(history.filter((action) => action === "step_recorded").length, 5);
    assert.equal(history.at(-1), "request_completed");
    assert.deepEqual(staffView.availableActions, []);
    // Nothing changes it after.
    for (const input of [
      { action: "record_step", system: "private_files", outcome: "confirmed" },
      { action: "complete" },
      { action: "hold" },
    ])
      await assert.rejects(act(staff, input), { status: 409 });
  },
);

// PRV-003: a data download is finished the same way, and the person can still fetch it once it is done.
test(
  "a partly done data download is marked done once its outside steps are recorded, and its prepared result stays the person's to fetch",
  { skip, timeout: 120000 },
  async () => {
    assertSyntheticDatabase();
    const staff = await privacyStaff();
    const download = await claimed("export", staff);
    let detail = await processPrivacyAction(staff, download.id, {
      action: "prepare_export",
      expectedVersion: download.detail.request.version,
      reason,
    });
    for (const system of [
      "private_files",
      "managed_identity",
      "external_processors",
      "retention_and_recovery",
    ])
      detail = await processPrivacyAction(staff, download.id, {
        action: "record_step",
        expectedVersion: detail.request.version,
        reason: `Synthetic: this data download needed nothing from ${system.replaceAll("_", " ")}.`,
        system,
        outcome: "not_applicable",
      });
    detail = await processPrivacyAction(staff, download.id, {
      action: "complete",
      expectedVersion: detail.request.version,
      reason: "Synthetic: the data download is ready, and nothing else was needed.",
    });
    assert.equal(detail.request.status, "fulfilled");
    assert.ok(
      await privacyPreparedResult(download.actor, download.id),
      "the prepared download is still theirs",
    );
  },
);
