import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { eq, inArray, sql } from "drizzle-orm";
import { workspaceActorFromRecord } from "../../platform/workspace-context";

/** Drizzle reports database errors as "Failed query: ..." with the database's own error
 * as the cause; match the database message anywhere in that chain. */
const databaseMessage = (pattern: RegExp) => (error: unknown) => {
  for (let e: unknown = error, depth = 0; e && depth < 5; depth++) {
    const item = e as { message?: unknown; cause?: unknown };
    if (pattern.test(String(item.message ?? ""))) return true;
    e = item.cause;
  }
  return false;
};

test(
  "actual durable support intake, assignment, replies, triage, privacy and HTTP authority",
  {
    skip: process.env.VALO_RUN_DB_TESTS !== "synthetic-development-only",
    timeout: 60000,
  },
  async (t) => {
    const { assertDevelopmentRuntime } = await import("../../platform/valo-development-runtime");
    assertDevelopmentRuntime();
    assert.ok(
      ["localhost", "127.0.0.1"].includes(new URL(process.env.DATABASE_URL!).hostname),
      "Disposable local PostgreSQL is required",
    );
    const {
      db,
      pool,
      valoSupportCases,
      valoSupportTickets,
      valoSupportMessages,
      valoSupportEvents,
      valoSupportActions,
      valoAccessSupport,
      valoStaffAssignments,
      valoMemberships,
      valoWorkspaces,
      valoEvents,
    } = await import("@workspace/db");
    const { createTicket } = await import(".");
    const { draftSynthetic } = await import("../../test-support/drafted-content");
    const { resolveWorkspace } = await import("../workspaces");
    const { ValoProblem } = await import("../../platform/valo-problem");
    const { saveAccessSupport, workspaceDataExport } = await import("../privacy/valo-customer-access");
    const api = await import("./valo-support-lifecycle");
    const { digest } = await import("@workspace/valo-core");
    const { heldSourceBundle } = await import("../sources/valo-source-controls.fixtures");
    const prefix = `synthetic-support-${randomUUID()}`,
      a = await resolveWorkspace(`${prefix}-a`),
      b = await resolveWorkspace(`${prefix}-b`);
    const ids = [a.workspaceId, b.workspaceId],
      staff = ["support", "content", "finance"].map((role) => ({ identityId: `${prefix}-${role}`, role }));
    staff.push({ identityId: `${prefix}-expired-support`, role: "support" });
    const actor = (n: number) => ({
      identityId: staff[n]!.identityId,
      recentMfa: true,
      verifiedAt: Date.now(),
    });
    for (const s of staff)
      await db.insert(valoStaffAssignments).values({
        id: randomUUID(),
        identityId: s.identityId,
        role: s.role as "support" | "content" | "finance",
        grantedBy: "synthetic-ci",
        reason: "Isolated support boundary test",
        // Only a time-limited emergency grant can expire (valo_staff_expiry_shape).
        ...(s.identityId.endsWith("-expired-support")
          ? {
              grantMode: "break_glass" as const,
              grantedAt: new Date(Date.now() - 600_000),
              expiresAt: new Date(Date.now() - 1000),
            }
          : {}),
      });
    const input = {
      category: "support",
      scope: "Synthetic content issue. Please retain the exact version for reassessment.",
      contactEmail: `${prefix}@example.invalid`,
      sharingConsent: true,
    };
    const ticket = await createTicket(a, input),
      id = (await api.customerSupportCases(a)).cases[0]!.id;
    const access = await saveAccessSupport(
      {
        idempotencyKey: randomUUID(),
        email: `access-${prefix}@example.invalid`,
        topic: "account_access",
        message: "Synthetic account access enquiry without inferred ownership.",
      },
      `socket-${prefix}`,
    );
    const accessId = (await api.staffSupportCases(actor(0))).cases.find(
      (c) => c.reference === access.reference,
    )!.id;
    let version = 1;
    const request = (action: string, extra: object = {}) => ({
      idempotencyKey: randomUUID(),
      expectedVersion: version,
      action,
      ...extra,
    });
    let contentId = "",
      sourcePolicy = "";
    try {
      await t.test(
        "intake and workflow commit together, preserving exact original reference and full scope",
        async () => {
          const detail = await api.customerSupportCase(a, id);
          assert.equal(detail.case.reference, ticket.reference);
          assert.equal(detail.case.scope, input.scope);
          assert.equal(detail.case.status, "open");
          assert.equal(detail.case.version, 1);
          assert.equal(
            (
              await db
                .select()
                .from(valoSupportCases)
                .where(eq(valoSupportCases.ticketId, ticket.reference.slice(5)))
            ).length,
            1,
          );
          assert.deepEqual(detail.messages, []);
          assert.ok(!("events" in detail));
          await assert.rejects(() => api.customerSupportCase(b, id), { status: 404 });
          await assert.rejects(() => api.customerSupportCase({ ...a, identityId: b.identityId }, id), {
            status: 403,
          });
        },
      );
      await t.test(
        "current role and MFA are required independently of login or content/finance permissions",
        async () => {
          await assert.rejects(() => api.staffSupportCases(actor(1)), { status: 403 });
          await assert.rejects(() => api.staffSupportCase({ ...actor(0), recentMfa: false }, id), {
            status: 403,
          });
          await assert.rejects(
            () => api.staffSupportCase({ ...actor(0), verifiedAt: Date.now() - 61000 }, id),
            { status: 403 },
          );
          await assert.rejects(() => api.contentSupportEscalations(actor(0)), { status: 403 });
          await assert.rejects(() => api.staffSupportCases(actor(3)), { status: 403 });
          assert.ok(
            !(await api.supportAssignees(actor(0))).assignees.some(
              (a) => a.identityId === staff[3]!.identityId,
            ),
          );
          // Only a time-limited emergency grant can expire (valo_staff_expiry_shape).
          await db
            .update(valoStaffAssignments)
            .set({
              grantMode: "break_glass",
              grantedAt: new Date(Date.now() - 600_000),
              expiresAt: new Date(Date.now() - 1000),
            })
            .where(eq(valoStaffAssignments.identityId, staff[1]!.identityId));
          try {
            await assert.rejects(() => api.contentSupportEscalations(actor(1)), { status: 403 });
          } finally {
            await db
              .update(valoStaffAssignments)
              .set({ grantMode: "permanent", expiresAt: null })
              .where(eq(valoStaffAssignments.identityId, staff[1]!.identityId));
          }
        },
      );
      await t.test("a role that expires during a database lock wait grants no support access", async () => {
        await db
          .update(valoStaffAssignments)
          .set({
            grantMode: "break_glass",
            grantedAt: new Date(Date.now() - 600_000),
            expiresAt: new Date(Date.now() + 1500),
          })
          .where(eq(valoStaffAssignments.identityId, staff[0]!.identityId));
        const lock = await pool.connect();
        let settled = false;
        try {
          await lock.query("BEGIN");
          await lock.query("SELECT id FROM valo_staff_assignments WHERE identity_id=$1 FOR UPDATE", [
            staff[0]!.identityId,
          ]);
          const pending = api.staffSupportCases(actor(0)).then(
            (value) => {
              settled = true;
              return { value, error: null };
            },
            (error) => {
              settled = true;
              return { value: null, error };
            },
          );
          let expired = false;
          for (let n = 0; n < 400 && !expired; n++) {
            expired = Boolean(
              (
                await db.execute(
                  sql`SELECT expires_at<=clock_timestamp() AS expired FROM valo_staff_assignments WHERE identity_id=${staff[0]!.identityId}`,
                )
              ).rows[0]!.expired,
            );
            if (!expired) await new Promise((resolve) => setTimeout(resolve, 10));
          }
          assert.equal(expired, true);
          assert.equal(settled, false, "the actual role lookup waited on the held row");
          await lock.query("COMMIT");
          const result = await pending;
          assert.equal(result.error?.status, 403);
          assert.equal(result.value, null);
        } finally {
          await lock.query("ROLLBACK");
          lock.release();
          await db
            .update(valoStaffAssignments)
            .set({ grantMode: "permanent", expiresAt: null })
            .where(eq(valoStaffAssignments.identityId, staff[0]!.identityId));
        }
      });
      await t.test("assignment, conflict and idempotent retry preserve one action and event", async () => {
        const assign = request("assign", { assigneeId: staff[0]!.identityId });
        const changed = await api.actOnSupportCase(actor(0), id, assign);
        version = changed.case.version;
        assert.equal(changed.case.assignedTo, staff[0]!.identityId);
        assert.equal(changed.case.status, "in_progress");
        assert.equal((await api.actOnSupportCase(actor(0), id, assign)).case.version, version);
        await assert.rejects(
          () => api.actOnSupportCase(actor(0), id, { ...assign, assigneeId: staff[1]!.identityId }),
          { status: 409 },
        );
        await assert.rejects(
          () =>
            api.actOnSupportCase(actor(0), id, {
              ...request("reply", { body: "Stale synthetic staff reply." }),
              expectedVersion: 1,
            }),
          { status: 409 },
        );
        assert.equal(
          (await db.select().from(valoSupportActions).where(eq(valoSupportActions.caseId, id))).length,
          1,
        );
        const [event] = await db.select().from(valoSupportEvents).where(eq(valoSupportEvents.caseId, id));
        await assert.rejects(
          () => db.delete(valoSupportEvents).where(eq(valoSupportEvents.id, event!.id)),
          databaseMessage(/append only/),
        );
        await assert.rejects(
          () => api.actOnSupportCase(actor(0), id, request("assign", { assigneeId: staff[2]!.identityId })),
          { status: 422 },
        );
        await assert.rejects(
          () => api.actOnSupportCase(actor(0), id, request("assign", { assigneeId: staff[3]!.identityId })),
          { status: 422 },
        );
      });
      await t.test(
        "staff reply is delivered only in the private portal; customer response reopens a resolved case",
        async () => {
          let result = await api.actOnSupportCase(
            actor(0),
            id,
            request("reply", {
              body: "Please confirm the affected document version in this private portal.",
            }),
          );
          version = result.case.version;
          assert.equal(result.case.status, "awaiting_customer");
          let own = await api.replyToSupportCase(a, id, {
            idempotencyKey: randomUUID(),
            expectedVersion: version,
            body: "The synthetic document version is one; no confidential data.",
          });
          version = own.case.version;
          assert.equal(own.case.status, "in_progress");
          result = await api.actOnSupportCase(
            actor(0),
            id,
            request("resolve", {
              body: "Saved response resolves this conversation; publication remains separately controlled.",
            }),
          );
          version = result.case.version;
          assert.equal(result.case.status, "resolved");
          await assert.rejects(
            () =>
              api.actOnSupportCase(
                actor(0),
                id,
                request("reply", { body: "Must explicitly reopen before another staff reply." }),
              ),
            { status: 409 },
          );
          own = await api.replyToSupportCase(a, id, {
            idempotencyKey: randomUUID(),
            expectedVersion: version,
            body: "Please reopen the same saved case for a content reassessment.",
          });
          version = own.case.version;
          assert.equal(own.case.status, "in_progress");
          assert.ok(own.messages.every((m) => m.visibility === "customer"));
          assert.match(own.notice, /No email/);
        },
      );
      await t.test(
        "anonymous account replies remain internal and cannot be claimed by a signed-in workspace",
        async () => {
          const detail = await api.staffSupportCase(actor(0), accessId);
          const result = await api.actOnSupportCase(actor(0), accessId, {
            idempotencyKey: randomUUID(),
            expectedVersion: detail.case.version,
            action: "reply",
            body: "Saved internal response. Contact verification and any outbound channel remain separate.",
          });
          assert.equal(result.case.status, "in_progress");
          assert.equal(result.messages[0]!.visibility, "internal");
          assert.match(result.notice, /No email or external message has been sent/);
          await assert.rejects(() => api.customerSupportCase(a, accessId), { status: 404 });
          await assert.rejects(
            () =>
              api.actOnSupportCase(actor(0), accessId, {
                idempotencyKey: randomUUID(),
                expectedVersion: result.case.version,
                action: "escalate_content",
                body: "Consent has not been supplied for this anonymous request.",
                targetKind: "content",
                targetId: randomUUID(),
              }),
            { status: 422 },
          );
        },
      );
      await t.test(
        "content-authorized hold survives failed support persistence and exact-key recovery after intervening updates",
        async () => {
          const now = new Date(),
            bundle = heldSourceBundle(now);
          contentId = randomUUID();
          sourcePolicy = `${prefix}-unapproved`;
          await db.execute(sql`INSERT INTO valo_publication_policies(id,hash,policy,authority)
        VALUES(${sourcePolicy},${digest(bundle.policy)},${JSON.stringify(bundle.policy)}::jsonb,'{"synthetic":true,"approved":false}')`);
          await draftSynthetic((tx) =>
            tx.execute(sql`INSERT INTO valo_content_versions(id,template_id,version,slug,policy_id,candidate_hash,bundle,attestations,status,review_by)
        VALUES(${contentId}::uuid,${prefix},1,${contentId},${sourcePolicy},${bundle.candidate.hash},${JSON.stringify(bundle)}::jsonb,'{}','candidate',${new Date(+now + 86400000)})`),
          );
          const queued = await api.actOnSupportCase(
            actor(0),
            id,
            request("escalate_content", {
              body: "Synthetic complaint requires exact-version source reassessment.",
              targetKind: "content",
              targetId: contentId,
            }),
          );
          version = queued.case.version;
          const referral = queued.escalations![0]!;
          assert.equal(referral.status, "queued");
          assert.equal(referral.sourceImpactId, null);
          assert.equal(
            (await db.execute(sql`SELECT id FROM valo_source_impacts WHERE target_id=${contentId}::uuid`))
              .rows.length,
            0,
          );
          const action = {
            idempotencyKey: randomUUID(),
            expectedVersion: version,
            action: "hold_and_reassess",
            body: "Content staff judged the exact held fixture suitable for synthetic reassessment.",
          };
          await assert.rejects(() => api.actOnContentSupportEscalation(actor(0), referral.id, action), {
            status: 403,
          });
          // Fail only the support completion transaction, after the independent
          // source authority has committed its real hold and durable review work.
          await db.execute(sql`CREATE FUNCTION valo_support_test_fail_completion() RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN RAISE EXCEPTION 'synthetic support completion failure'; END $$`);
          await db.execute(sql`CREATE TRIGGER valo_support_test_fail_completion BEFORE INSERT ON valo_support_events
        FOR EACH ROW WHEN (NEW.action='content_triage_hold_and_reassess') EXECUTE FUNCTION valo_support_test_fail_completion()`);
          try {
            await assert.rejects(() => api.actOnContentSupportEscalation(actor(1), referral.id, action));
            assert.equal(
              (
                await db.execute(
                  sql`SELECT id FROM valo_safety_control_audit WHERE request_key=${action.idempotencyKey}::uuid`,
                )
              ).rows.length,
              1,
            );
            assert.equal(
              (await db.execute(sql`SELECT id FROM valo_source_impacts WHERE target_id=${contentId}::uuid`))
                .rows.length,
              1,
            );
            const unchanged = await api.staffSupportCase(actor(0), id);
            assert.equal(unchanged.case.version, version);
            assert.equal(unchanged.escalations![0]!.sourceImpactId, null);
          } finally {
            await db.execute(sql`DROP TRIGGER valo_support_test_fail_completion ON valo_support_events`);
            await db.execute(sql`DROP FUNCTION valo_support_test_fail_completion()`);
          }
          const second = { workspaceId: a.workspaceId, identityId: `${prefix}-second` };
          await db
            .insert(valoMemberships)
            .values({ id: randomUUID(), ...second, role: "owner", active: "yes" });
          const replied = await api.replyToSupportCase(workspaceActorFromRecord(second), id, {
            idempotencyKey: randomUUID(),
            expectedVersion: version,
            body: "An intervening private reply must not cause a repeated content hold.",
          });
          version = replied.case.version;
          const closed = await api.actOnContentSupportEscalation(actor(1), referral.id, {
            idempotencyKey: randomUUID(),
            expectedVersion: version,
            action: "resolve",
            body: "Triage conversation closed while the separate source review remains queued.",
          });
          version = closed.caseVersion;
          const held = await api.actOnContentSupportEscalation(actor(1), referral.id, action);
          version = held.caseVersion;
          assert.equal(held.escalation.status, "resolved");
          assert.ok(held.escalation.sourceImpactId);
          assert.equal(
            (await api.actOnContentSupportEscalation(actor(1), referral.id, action)).escalation
              .sourceImpactId,
            held.escalation.sourceImpactId,
          );
          assert.equal(
            (await db.execute(sql`SELECT id FROM valo_source_impacts WHERE target_id=${contentId}::uuid`))
              .rows.length,
            1,
          );
          assert.equal(
            (
              await db.execute(
                sql`SELECT id FROM valo_safety_control_audit WHERE request_key=${action.idempotencyKey}::uuid`,
              )
            ).rows.length,
            1,
          );
          await assert.rejects(
            () =>
              api.actOnContentSupportEscalation(actor(1), referral.id, {
                ...action,
                body: "Changed intent cannot reuse the committed source authority key.",
              }),
            { status: 409 },
          );
          const work = (
            await db.execute(
              sql`SELECT status FROM valo_source_review_work WHERE impact_id=${held.escalation.sourceImpactId}::uuid`,
            )
          ).rows;
          assert.equal(work.length, 1);
          assert.match(held.notice, /No AI review/);
          const customer = await api.customerSupportCase(a, id);
          assert.ok(!("escalations" in customer));
          assert.ok(!customer.messages.some((m) => m.body === action.body));
          const audit = (
            await db.execute(
              sql`SELECT reason FROM valo_safety_control_audit WHERE request_key=${action.idempotencyKey}::uuid`,
            )
          ).rows[0];
          assert.ok(!String(audit?.reason).includes(action.body));
        },
      );
      await t.test("message pagination and account export never include internal triage text", async () => {
        await db.insert(valoSupportMessages).values(
          Array.from({ length: 55 }, (_, i) => ({
            id: randomUUID(),
            caseId: id,
            workspaceId: a.workspaceId,
            authorId: a.identityId,
            authorKind: "customer" as const,
            visibility: "customer" as const,
            body: `Synthetic pagination reply number ${i}.`,
          })),
        );
        const first = await api.customerSupportCase(a, id, 1),
          second = await api.customerSupportCase(a, id, 2);
        assert.equal(first.messages.length, 50);
        assert.equal(first.moreMessages, true);
        assert.ok(second.messages.length > 0);
        assert.ok(!first.messages.some((x) => second.messages.some((y) => x.id === y.id)));
        const exported = await workspaceDataExport(a);
        const replies = exported.data.supportReplies as { body: string }[];
        assert.ok(replies.length > 50);
        assert.ok(!replies.some((r) => r.body.includes("Content staff judged")));
        const other = await workspaceDataExport(b);
        assert.equal((other.data.supportReplies as unknown[]).length, 0);
      });
      await t.test(
        "actual HTTP routes reject missing staff identity, cross-area access and untrusted origins",
        async () => {
          const { default: express } = await import("express");
          const { makeSupportOperationsRouter, supportCustomerRouter } =
            await import("../../routes/valo-support-lifecycle");
          const app = express();
          app.use(express.json());
          app.use(
            makeSupportOperationsRouter(async (req) => {
              const index = req.header("x-controlled-role");
              if (index !== "0" && index !== "1") throw new ValoProblem(401, "Controlled identity required");
              return actor(Number(index));
            }),
          );
          app.use((req, res, next) => {
            res.locals.valoActor = req.header("x-controlled-owner") === "a" ? a : b;
            next();
          }, supportCustomerRouter);
          app.use((error: unknown, _req: any, res: any, _next: any) =>
            res
              .status(error instanceof ValoProblem ? error.status : 500)
              .json({ error: "Controlled failure" }),
          );
          const server = app.listen(0, "127.0.0.1");
          await new Promise<void>((resolve) => server.once("listening", resolve));
          const address = server.address();
          assert.ok(address && typeof address !== "string");
          const origin = `http://127.0.0.1:${address.port}`;
          const old = process.env.VALO_TRUSTED_ORIGIN;
          process.env.VALO_TRUSTED_ORIGIN = origin;
          try {
            assert.equal((await fetch(`${origin}/admin/support-cases`)).status, 401);
            assert.equal(
              (await fetch(`${origin}/admin/support-cases`, { headers: { "x-controlled-role": "1" } }))
                .status,
              403,
            );
            const success = await fetch(`${origin}/admin/support-cases`, {
              headers: { "x-controlled-role": "0" },
            });
            assert.equal(success.status, 200);
            assert.match(success.headers.get("cache-control")!, /private, no-store/);
            assert.equal((await fetch(`${origin}/workspace/support-cases/${id}`)).status, 404);
            assert.equal(
              (
                await fetch(`${origin}/admin/support-cases/${id}/action`, {
                  method: "POST",
                  headers: {
                    "x-controlled-role": "0",
                    "content-type": "application/json",
                    origin: "https://example.invalid",
                  },
                  body: JSON.stringify(
                    request("resolve", { body: "This cross-origin action must not mutate the case." }),
                  ),
                })
              ).status,
              403,
            );
          } finally {
            await new Promise<void>((resolve, reject) =>
              server.close((error) => (error ? reject(error) : resolve())),
            );
            if (old === undefined) delete process.env.VALO_TRUSTED_ORIGIN;
            else process.env.VALO_TRUSTED_ORIGIN = old;
          }
        },
      );
      await t.test("revoked membership and staff role fail before new messages or decisions", async () => {
        await db
          .update(valoMemberships)
          .set({ active: "no" })
          .where(eq(valoMemberships.workspaceId, a.workspaceId));
        await assert.rejects(() => api.customerSupportCase(a, id), { status: 403 });
        await db
          .update(valoStaffAssignments)
          .set({ active: false })
          .where(eq(valoStaffAssignments.identityId, staff[0]!.identityId));
        await assert.rejects(
          () =>
            api.actOnSupportCase(
              actor(0),
              id,
              request("resolve", { body: "Revoked staff must not change this case." }),
            ),
          { status: 403 },
        );
      });
    } finally {
      // Owned synthetic intake deletion cascades case text and metadata. Durable
      // content-hold lineage remains in the disposable CI database, with no active role.
      await db
        .delete(valoAccessSupport)
        .where(eq(valoAccessSupport.id, access.reference.slice("VALO-ACCESS-".length)));
      await db.delete(valoSupportTickets).where(inArray(valoSupportTickets.workspaceId, ids));
      await db.delete(valoEvents).where(inArray(valoEvents.workspaceId, ids));
      await db.delete(valoMemberships).where(inArray(valoMemberships.workspaceId, ids));
      await db.delete(valoWorkspaces).where(inArray(valoWorkspaces.id, ids));
      await db
        .update(valoStaffAssignments)
        .set({ active: false })
        .where(
          inArray(
            valoStaffAssignments.identityId,
            staff.map((s) => s.identityId),
          ),
        );
      await pool.end();
    }
  },
);
