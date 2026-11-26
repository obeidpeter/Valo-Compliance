import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { and, eq, inArray, sql } from "drizzle-orm";

const skip = process.env.VALO_RUN_DB_TESTS !== "synthetic-development-only";
const reason = "Synthetic incident rehearsal; no customer or provider data.";

// SEC-008: "a tabletop incident demonstrates containment, evidence preservation, privacy escalation and
// customer communications." This takes the technical steps of the tabletop (docs/valo/incident-tabletop.md)
// through Valo's own levers, as the procedure (docs/valo/incident-procedure.md) names them, on a disposable
// database. It shows that the levers work; it is not a tabletop, and it accepts nothing. It pauses the
// drafting assistant and checkout for every workspace, so it runs on its own (test:valo-incident-rehearsal-db).
test(
  "an incident rehearsal on synthetic data detects the refusals and the role change, contains them, keeps the workspace's data and the histories as they are, and answers the person affected in the app without sending anything",
  { skip, timeout: 180000 },
  async () => {
    assert.equal(process.env.NODE_ENV, "development");
    assert.ok(!process.env.REPLIT_DEPLOYMENT);
    assert.ok(["localhost", "127.0.0.1", "[::1]"].includes(new URL(process.env.DATABASE_URL!).hostname));
    const {
      db,
      pool,
      valoMemberships,
      valoEvents,
      valoPrivacyCases,
      valoPrivacyEvents,
      valoPrivacyHolds,
      valoStaffAccessAudit,
      valoStaffAssignments,
      valoStaffRoleChanges,
      valoSupportActions,
      valoSupportCases,
      valoSupportEscalations,
      valoSupportEvents,
      valoSupportMessages,
      valoSupportTickets,
      valoWorkspaces,
    } = await import("@workspace/db");
    const { recordSecuritySignal } = await import("../../lib/valo-security-signals");
    const { collectOperationalSample, recordOperationalAlerts } = await import("./valo-operations");
    const { actOnSourceControls } = await import("../sources/valo-source-controls");
    const { assertSafetyActive } = await import("../sources/valo-source-state");
    const { makeStaffRoleService } = await import("../staff/valo-staff-roles");
    const { confirmPrivacyCase, createPrivacyCase, staffPrivacyDetail } =
      await import("../privacy/valo-privacy");
    const { placePrivacyHold, releasePrivacyHold } = await import("../privacy/valo-privacy-holds");
    const { privateCleanupAuthority } = await import("../privacy/valo-private-cleanup-authority");
    const { createTicket } = await import("../support");
    const { actOnSupportCase, customerSupportCase, customerSupportCases } =
      await import("../support/valo-support-lifecycle");
    const { resolveWorkspace } = await import("../workspaces");

    const tag = randomUUID();
    const member = (identityId: string) => ({ identityId, recentMfa: true, verifiedAt: Date.now() });
    const fresh = <T extends { verifiedAt: number }>(actor: T) => ({ ...actor, verifiedAt: Date.now() });
    // The two whose role changes are kept for good have the sign-in provider's form of an identity, as a
    // role change requires; the rest are synthetic test identities.
    const lead = member(`user_synthetic_incident_lead_${tag}`),
      suspect = member(`user_synthetic_incident_suspect_${tag}`),
      placer = member(`synthetic-incident-privacy-${tag}`),
      releaser = member(`synthetic-incident-privacy-second-${tag}`),
      support = member(`synthetic-incident-support-${tag}`);
    const staff = [
      [lead, "system"],
      [suspect, "privacy"],
      [placer, "privacy"],
      [releaser, "privacy"],
      [support, "support"],
    ] as const;
    const services = ["ai", "checkout"] as const;
    const paused = async () =>
      (
        await db.execute(
          sql`select key from valo_safety_switches where key in ('all_ai','checkout') and enabled = false`,
        )
      ).rows;
    // The rehearsal leaves both services as it found them, running.
    assert.deepEqual(await paused(), [], "Neither service may already be paused");
    const directory = await mkdtemp(join(tmpdir(), "valo-incident-rehearsal-"));
    let person: Awaited<ReturnType<typeof resolveWorkspace>> | undefined;
    let pausedHere = false;
    try {
      for (const [actor, role] of staff)
        await db.insert(valoStaffAssignments).values({
          id: randomUUID(),
          identityId: actor.identityId,
          role,
          grantedBy: "synthetic-incident-rehearsal",
          reason,
        });
      // The person affected: a deletion request of theirs, and a support request opened before.
      person = await resolveWorkspace(`synthetic-incident-person-${tag}`);
      const workspaceId = person.workspaceId;
      const made = await createPrivacyCase(person, "synthetic@example.invalid", {
        kind: "deletion",
        idempotencyKey: randomUUID(),
        message: reason,
        acknowledgement: true,
      });
      const caseId = made.reference.slice(5);
      await confirmPrivacyCase(person, caseId, { expectedVersion: 1, acknowledgement: true });
      await createTicket(person, {
        category: "support",
        scope: "Synthetic: a question about my account, asked before the incident.",
        contactEmail: `synthetic-incident-${tag}@example.invalid`,
        sharingConsent: true,
      });
      const supportCaseId = (await customerSupportCases(person)).cases[0]!.id;
      const alerts = async () =>
        recordOperationalAlerts(await collectOperationalSample((text) => pool.query(text)), directory);
      const owner = (raised: Awaited<ReturnType<typeof alerts>>, code: string) =>
        raised.owners.find((entry) => entry.code === code);
      const incidentRunbook = {
        runbook: "Security/privacy incident",
        accountable: "Incident lead + privacy owner",
      };

      // Detection (step 1): one address refused again and again raises its alert, under the incident
      // runbook, with the privacy owner accountable. The suspect account reads the person's request.
      const address = createHash("sha256").update(`synthetic-incident-address-${tag}`).digest("hex");
      for (let n = 0; n < 21; n++) await recordSecuritySignal("denied_access", address);
      let raised = await alerts();
      assert.deepEqual(owner(raised, "DENIED_ACCESS_DETECTED"), {
        code: "DENIED_ACCESS_DETECTED",
        ...incidentRunbook,
      });
      await staffPrivacyDetail(fresh(suspect), caseId);
      const reads = async () =>
        (
          await db
            .select({ id: valoStaffAccessAudit.id, object: valoStaffAccessAudit.object })
            .from(valoStaffAccessAudit)
            .where(eq(valoStaffAccessAudit.actorId, suspect.identityId))
        )
          .map((row) => `${row.id} ${row.object}`)
          .sort();
      const read = await reads();
      assert.ok(read.some((row) => row.endsWith(`privacy_case:${caseId}`)));

      // Containment (step 2): the incident lead pauses the drafting assistant and checkout, which then
      // refuse new work, and revokes the suspect's privacy assignment, which is then refused.
      for (const service of services)
        await actOnSourceControls(fresh(lead), {
          action: "pause_service",
          service,
          requestKey: randomUUID(),
          reason,
        });
      pausedHere = true;
      for (const service of services)
        await assert.rejects(
          db.transaction((tx) => assertSafetyActive(tx, service)),
          { status: 503 },
        );
      const [assignment] = await db
        .select({ version: valoStaffAssignments.version })
        .from(valoStaffAssignments)
        .where(
          and(
            eq(valoStaffAssignments.identityId, suspect.identityId),
            eq(valoStaffAssignments.role, "privacy"),
          ),
        );
      const roles = makeStaffRoleService(async () => {
        throw Error("A revocation looks up no account at the sign-in provider.");
      });
      await roles.change(fresh(lead), {
        requestKey: randomUUID(),
        identityId: suspect.identityId,
        role: "privacy",
        action: "revoke",
        expectedVersion: assignment!.version,
        reason: "Synthetic: the account was used by someone else.",
        acknowledgement: true,
      });
      await assert.rejects(staffPrivacyDetail(fresh(suspect), caseId), { status: 403 });
      // The revocation is a role change, which raises its own alert under the incident runbook.
      raised = await alerts();
      assert.deepEqual(owner(raised, "ROLE_CHANGES_DETECTED"), {
        code: "ROLE_CHANGES_DETECTED",
        ...incidentRunbook,
      });

      // Evidence preservation (step 3): privacy staff hold the workspace, so Valo's own deletion of its
      // data stops. The suspect's reads stay, and neither they nor the hold can be changed or removed.
      // The pauses and the revocation are kept with who made them and why.
      const hold = await placePrivacyHold(fresh(placer), {
        workspaceId,
        reason: "Synthetic: kept as it is while the incident is looked into.",
      });
      assert.deepEqual(await db.transaction((tx) => privateCleanupAuthority(tx, workspaceId)), {
        allowed: false,
        privacyOwned: false,
        workspaceHeld: true,
      });
      assert.deepEqual(await reads(), read);
      // The database's refusal, under the driver's wrapper.
      const refusedBy = (words: RegExp) => (error: unknown) =>
        words.test(String((error as { cause?: Error }).cause?.message ?? error));
      await assert.rejects(
        db.execute(sql`delete from valo_staff_access_audit where actor_id = ${suspect.identityId}`),
        refusedBy(/append-only/),
      );
      await assert.rejects(
        db.execute(
          sql`update valo_staff_access_audit set reason = 'Synthetic: changed afterwards.' where actor_id = ${suspect.identityId}`,
        ),
        refusedBy(/append-only/),
      );
      await assert.rejects(
        db.execute(
          sql`update valo_privacy_holds set reason = 'Synthetic: changed afterwards.' where id = ${hold.id}::uuid`,
        ),
        refusedBy(/released once and never removed/),
      );
      const pauses = (
        await db.execute<{ target: string; reason: string }>(
          sql`select target, reason from valo_safety_control_audit where actor_id = ${lead.identityId} order by target`,
        )
      ).rows;
      assert.deepEqual(pauses, [
        { target: "all_ai", reason },
        { target: "checkout", reason },
      ]);
      const revocations = await db
        .select({ action: valoStaffRoleChanges.action, role: valoStaffRoleChanges.role })
        .from(valoStaffRoleChanges)
        .where(
          and(
            eq(valoStaffRoleChanges.actorId, lead.identityId),
            eq(valoStaffRoleChanges.targetIdentityId, suspect.identityId),
          ),
        );
      assert.deepEqual(revocations, [{ action: "revoke", role: "privacy" }]);
      const mismatched = (
        await db.execute<{ name: string }>(sql`select name from valo_history_digest_mismatches() as name`)
      ).rows.map((row) => row.name);
      assert.ok(!mismatched.includes("valo_privacy_holds"), "The holds' history matches its digest");

      // Privacy escalation (step 4): the alerts name the privacy owner as accountable (above). The revoked
      // account cannot release the hold, nor can the member who placed it.
      await assert.rejects(releasePrivacyHold(fresh(suspect), hold.id, { reason }), { status: 403 });
      await assert.rejects(releasePrivacyHold(fresh(placer), hold.id, { reason }), { status: 403 });

      // Customer communications (step 5): support staff answer the person on their own support request,
      // starting from the procedure's draft; the person reads it in the app, and nothing is sent outside it.
      const notice =
        "We are writing about your Valo account. We found that someone else used a member of staff's access and read your privacy request. It did not affect your saved documents. We stopped the access and are keeping your workspace's data as it is while we look into it. If you have a question, reply to this message.";
      await actOnSupportCase(fresh(support), supportCaseId, {
        idempotencyKey: randomUUID(),
        expectedVersion: 1,
        action: "reply",
        body: notice,
      });
      const seen = await customerSupportCase(person, supportCaseId);
      assert.ok(seen.messages.some((message) => message.authorKind === "staff" && message.body === notice));
      for (const table of ["valo_purchase_outbox", "valo_reminder_outbox"])
        assert.equal(
          (
            await db.execute<{ n: number }>(
              sql`select count(*)::int as n from ${sql.identifier(table)} where workspace_id = ${workspaceId}::uuid`,
            )
          ).rows[0]!.n,
          0,
        );

      // Recovery (step 6): another member of privacy staff releases the hold, and the incident lead lifts
      // the pauses, after which the services take new work again.
      await releasePrivacyHold(fresh(releaser), hold.id, { reason: "Synthetic: the cause is fixed." });
      assert.equal((await db.transaction((tx) => privateCleanupAuthority(tx, workspaceId))).allowed, true);
      for (const service of services)
        await actOnSourceControls(fresh(lead), {
          action: "resume_service",
          service,
          requestKey: randomUUID(),
          reason,
        });
      pausedHere = false;
      for (const service of services) await db.transaction((tx) => assertSafetyActive(tx, service));
      assert.deepEqual(await paused(), []);
    } finally {
      // Never leave the services paused for the steps that run after this one.
      if (pausedHere)
        for (const service of services)
          await actOnSourceControls(fresh(lead), {
            action: "resume_service",
            service,
            requestKey: randomUUID(),
            reason,
          });
      // The role change and the lead's and the suspect's reads are kept, as staff records are; the
      // assignments end.
      await db
        .update(valoStaffAssignments)
        .set({ active: false })
        .where(
          inArray(
            valoStaffAssignments.identityId,
            staff.map(([actor]) => actor.identityId),
          ),
        );
      await db
        .delete(valoStaffAccessAudit)
        .where(
          inArray(valoStaffAccessAudit.actorId, [placer.identityId, releaser.identityId, support.identityId]),
        );
      if (person) {
        const workspaceId = person.workspaceId;
        await db.transaction(async (tx) => {
          // The synthetic workspace's holds go with their triggers on, so the holds' digest stays true.
          await tx.delete(valoPrivacyHolds).where(eq(valoPrivacyHolds.workspaceId, workspaceId));
          await tx.execute(sql`SET LOCAL session_replication_role=replica`);
          const cases = tx
            .select({ id: valoSupportCases.id })
            .from(valoSupportCases)
            .where(eq(valoSupportCases.workspaceId, workspaceId));
          for (const table of [valoSupportActions, valoSupportEvents, valoSupportEscalations])
            await tx.delete(table).where(inArray(table.caseId, cases));
          for (const table of [
            valoSupportMessages,
            valoSupportCases,
            valoSupportTickets,
            valoPrivacyEvents,
            valoPrivacyCases,
            valoEvents,
            valoMemberships,
          ])
            await tx.delete(table).where(eq(table.workspaceId, workspaceId));
          await tx.delete(valoWorkspaces).where(eq(valoWorkspaces.id, workspaceId));
        });
      }
      await rm(directory, { recursive: true, force: true });
      await pool.end();
    }
  },
);
