import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import express from "express";
import { and, eq, sql } from "drizzle-orm";
import { db, pool, valoStaffAssignments, valoStaffRoleChanges } from "@workspace/db";
import { makeStaffRoleService } from "../staff/valo-staff-roles";
import { createAcceptanceReviewRouter } from "../../routes/valo-acceptance-review";
import { listAcceptanceCases, recordAcceptanceDecision } from "./acceptance-review";
import { confirmationClaim, corpusCases } from "./acceptance-cases";
import { ValoProblem } from "../../platform/valo-problem";

// EDP-010, RUL-008 and AI-008 (decision 0016, docs/architecture/reviewer-record.md, slice 1): only an
// active reviewer with recent MFA records a decision, a decision holds only for the case's hash, the
// database keeps every decision as written, and no one holds the reviewer and content roles at once.
test(
  "the reviewer's record: an active reviewer's decisions, kept for good, from someone who prepares no content",
  { skip: process.env.VALO_RUN_STAFF_ROLE_TESTS !== "synthetic-development-only", timeout: 60000 },
  async (t) => {
    assert.equal(process.env.NODE_ENV, "development");
    assert.ok(!process.env.REPLIT_DEPLOYMENT);
    const suffix = randomUUID().slice(0, 8);
    const system = `user_synthetic_review_system_${suffix}`,
      reviewer = `user_synthetic_reviewer_${suffix}`,
      editor = `user_synthetic_review_editor_${suffix}`,
      second = `user_synthetic_second_reviewer_${suffix}`,
      lapsed = `user_synthetic_lapsed_editor_${suffix}`;
    const actor = (identityId: string) => ({ identityId, recentMfa: true, verifiedAt: Date.now() });
    // This suite's own administrator, switched off when it ends, so it never outlives the suite.
    const administrator = randomUUID();
    await db.insert(valoStaffAssignments).values({
      id: administrator,
      identityId: system,
      role: "system",
      grantedBy: "owned synthetic bootstrap",
      reason: "Disposable test database bootstrap only",
    });
    t.after(async () => {
      await db
        .update(valoStaffAssignments)
        .set({ active: false, version: sql`${valoStaffAssignments.version} + 1` })
        .where(eq(valoStaffAssignments.id, administrator));
    });
    const service = makeStaffRoleService(async (id) => ({
      id,
      label: `${id}@example.invalid`,
      banned: false,
      locked: false,
      verifiedPrimary: true,
      verifiedAt: Date.now(),
    }));
    const version = async (identityId: string, role: string) =>
      (
        await db
          .select({ version: valoStaffAssignments.version })
          .from(valoStaffAssignments)
          .where(
            and(
              eq(valoStaffAssignments.identityId, identityId),
              eq(valoStaffAssignments.role, role as "reviewer"),
            ),
          )
      )[0]?.version ?? 0;
    const change = async (
      identityId: string,
      role: string,
      action: "grant" | "revoke" = "grant",
      rest: Record<string, unknown> = {},
    ) =>
      service.change(actor(system), {
        requestKey: randomUUID(),
        identityId,
        role,
        action,
        ...(action === "grant" ? { grantMode: "permanent" } : {}),
        expectedVersion: await version(identityId, role),
        reason: "Owned synthetic reviewer independence test",
        acknowledgement: true,
        ...rest,
      });
    const decisions = async () =>
      Number(
        (
          await pool.query<{ n: string }>(
            "select count(*) as n from valo_acceptance_reviews where reviewer = any($1)",
            [[reviewer, editor, second, lapsed]],
          )
        ).rows[0]!.n,
      );
    const editorial = corpusCases("editorial");
    const body = (index = 0, rest: Record<string, unknown> = {}) => ({
      corpus: "editorial",
      caseId: editorial[index]!.id,
      caseHash: editorial[index]!.hash,
      answer: "confirmed",
      reason: "The cited source excerpt supports the expected hold outcome.",
      ...rest,
    });
    const refusedBy = (message: string) => (error: unknown) =>
      String((error as { cause?: { message?: string } }).cause?.message ?? (error as Error).message).includes(
        message,
      );

    await t.test(
      "only an active reviewer with recent MFA reads the cases and records a decision",
      async () => {
        await assert.rejects(listAcceptanceCases(actor(reviewer), "editorial"), { status: 403 });
        const grant = await change(reviewer, "reviewer");
        assert.equal(grant.role, "reviewer");
        assert.equal(grant.after?.role, "reviewer");
        const [audited] = await db
          .select()
          .from(valoStaffRoleChanges)
          .where(eq(valoStaffRoleChanges.id, grant.id));
        assert.equal(audited?.targetIdentityId, reviewer, "the role audit records the reviewer grant");
        await change(editor, "content");
        for (const call of [
          () => listAcceptanceCases(actor(editor), "editorial"),
          () => recordAcceptanceDecision(actor(editor), body()),
          // Input is read only after the role: other staff learn nothing of the corpora or the cases.
          () => listAcceptanceCases(actor(editor), "no-such-corpus"),
          () => recordAcceptanceDecision(actor(editor), { anything: true }),
          () => listAcceptanceCases({ ...actor(reviewer), recentMfa: false }, "editorial"),
          () => listAcceptanceCases({ ...actor(reviewer), verifiedAt: Date.now() - 30001 }, "editorial"),
          () => recordAcceptanceDecision({ ...actor(reviewer), recentMfa: false }, body()),
        ])
          await assert.rejects(call(), { status: 403 });
        await assert.rejects(listAcceptanceCases(actor(reviewer), "no-such-corpus"), { status: 404 });
        const listed = await listAcceptanceCases(actor(reviewer), "editorial");
        assert.equal(listed.corpus, "editorial");
        assert.equal(listed.claim, confirmationClaim);
        assert.equal(listed.cases.length, 60);
        assert.deepEqual(
          listed.cases.map(({ id, hash }) => ({ id, hash })),
          editorial.map(({ id, hash }) => ({ id, hash })),
        );
        assert.ok(listed.cases.every((item) => item.decision === null && item.decisions === 0));
        assert.equal((await listAcceptanceCases(actor(reviewer), "checker")).cases.length, 80);
        assert.equal((await listAcceptanceCases(actor(reviewer), "customer_ai")).cases.length, 60);
        assert.equal(await decisions(), 0);
      },
    );

    await t.test(
      "a decision says why and holds only for the case's hash as the reviewer read it",
      async () => {
        const first = await recordAcceptanceDecision(actor(reviewer), body());
        const item = first.cases[0]!;
        assert.equal(item.decision?.answer, "confirmed");
        assert.equal(item.decision?.reason, "The cited source excerpt supports the expected hold outcome.");
        assert.equal(item.decision?.reviewer, reviewer);
        assert.ok(Math.abs(Date.parse(item.decision!.createdAt) - Date.now()) < 60_000);
        assert.equal(item.decisions, 1);
        assert.deepEqual([first.confirmed, first.rejected], [1, 0]);
        await assert.rejects(recordAcceptanceDecision(actor(reviewer), body(1, { reason: "Too short." })), {
          status: 422,
        });
        await assert.rejects(
          recordAcceptanceDecision(actor(reviewer), body(1, { reason: `   ${"x".repeat(15)}   ` })),
          { status: 422 },
        );
        await assert.rejects(
          recordAcceptanceDecision(actor(reviewer), body(1, { caseHash: editorial[2]!.hash })),
          { status: 409 },
        );
        await assert.rejects(
          recordAcceptanceDecision(actor(reviewer), body(1, { caseId: "EVAL-EDP-C999" })),
          { status: 404 },
        );
        await assert.rejects(recordAcceptanceDecision(actor(reviewer), body(1, { answer: "met" })), {
          name: "ZodError",
        });
        await assert.rejects(recordAcceptanceDecision(actor(reviewer), body(1, { reviewer: editor })), {
          name: "ZodError",
        });
        assert.equal(await decisions(), 1, "a refused decision writes nothing");
        // A later decision supersedes an earlier one by adding a row.
        const second = await recordAcceptanceDecision(
          actor(reviewer),
          body(0, {
            answer: "rejected",
            reason: "The expected outcome omits the exception in the cited section.",
          }),
        );
        assert.equal(second.cases[0]!.decision?.answer, "rejected");
        assert.equal(second.cases[0]!.decisions, 2);
        assert.deepEqual([second.confirmed, second.rejected], [0, 1]);
        // A decision on another hash (the case's words as they once were) is not a decision on these words.
        await pool.query(
          `insert into valo_acceptance_reviews(corpus,case_id,case_hash,judgment,answer,reason,reviewer)
         values('editorial',$1,$2,'expected_outcome','confirmed','A decision on the earlier words of this case.',$3)`,
          [editorial[1]!.id, "0".repeat(64), reviewer],
        );
        const listed = await listAcceptanceCases(actor(reviewer), "editorial");
        assert.equal(listed.cases[1]!.decision, null);
        assert.equal(listed.cases[1]!.decisions, 0);
        assert.equal(await decisions(), 3);
      },
    );

    await t.test("the database keeps every decision as written, from an active reviewer only", async () => {
      const [row] = (
        await pool.query<{ id: string }>(
          "select id from valo_acceptance_reviews where reviewer = $1 limit 1",
          [reviewer],
        )
      ).rows;
      await assert.rejects(
        pool.query("update valo_acceptance_reviews set answer = 'rejected' where id = $1", [row!.id]),
        /A review decision is never changed or removed/,
      );
      await assert.rejects(
        pool.query("delete from valo_acceptance_reviews where id = $1", [row!.id]),
        /A review decision is never changed or removed/,
      );
      await assert.rejects(pool.query("truncate valo_acceptance_reviews"));
      const insert = (who: string, rest = "'expected_outcome','confirmed'") =>
        pool.query(
          `insert into valo_acceptance_reviews(corpus,case_id,case_hash,judgment,answer,reason,reviewer,created_at)
           values('editorial',$1,$2,${rest},'Written straight into the database by a test.',$3,'2020-01-01')`,
          [editorial[3]!.id, editorial[3]!.hash, who],
        );
      await assert.rejects(insert(editor), /An active reviewer is required/);
      await assert.rejects(insert(system), /An active reviewer is required/);
      await assert.rejects(insert(reviewer, "'expected_outcome','met'"), /valo_acceptance_reviews_judgment/);
      await assert.rejects(insert(reviewer, "'run_outcome','met'"), /valo_acceptance_reviews_judgment/);
      const written = await insert(reviewer);
      assert.equal(written.rowCount, 1);
      const { rows } = await pool.query<{ created_at: Date }>(
        "select created_at from valo_acceptance_reviews where reviewer = $1 and case_id = $2",
        [reviewer, editorial[3]!.id],
      );
      assert.ok(
        Math.abs(rows[0]!.created_at.getTime() - Date.now()) < 60_000,
        "the database dates it itself",
      );
      assert.equal(await decisions(), 4);
    });

    await t.test(
      "no one holds the reviewer and content roles at once, emergency grants included",
      async () => {
        await assert.rejects(change(reviewer, "content"), {
          status: 409,
          message:
            "This person is an acceptance reviewer. A reviewer cannot also prepare content: revoke the reviewer role first.",
        });
        await assert.rejects(change(editor, "reviewer"), {
          status: 409,
          message:
            "This person holds the content role. A reviewer cannot also prepare content: revoke the content role first.",
        });
        await assert.rejects(
          change(reviewer, "content", "grant", {
            grantMode: "break_glass",
            durationMinutes: 15,
            incidentReference: "INC-synthetic-1",
          }),
          { status: 409 },
        );
        // Written any other way, the database refuses the pair too.
        await assert.rejects(
          db.insert(valoStaffAssignments).values({
            id: randomUUID(),
            identityId: reviewer,
            role: "content",
            grantedBy: "a direct write",
            reason: "Written straight into the database by a test",
          }),
          refusedBy("A reviewer cannot also hold the content role"),
        );
        // An emergency grant that has ended does not count.
        const now = Date.now();
        await db.insert(valoStaffAssignments).values({
          id: randomUUID(),
          identityId: lapsed,
          role: "content",
          grantMode: "break_glass",
          grantedAt: new Date(now - 30 * 60_000),
          expiresAt: new Date(now - 20 * 60_000),
          grantedBy: "owned synthetic bootstrap",
          reason: "An emergency grant that ended",
        });
        assert.equal((await change(lapsed, "reviewer")).role, "reviewer");
        // Two grants at once of the two roles to one person: one waits for the other, and is refused.
        const [one, two] = [await pool.connect(), await pool.connect()];
        try {
          const grantFor = (role: string) =>
            `insert into valo_staff_assignments(id,identity_id,role,granted_by,reason) values('${randomUUID()}','${second}','${role}','a direct write','Two grants at once, written by a test')`;
          await one.query("begin");
          await two.query("begin");
          await one.query(grantFor("reviewer"));
          const racing = two.query(grantFor("content"));
          const settled = racing.then(
            () => "granted",
            (error: Error) => error.message,
          );
          await new Promise((resolve) => setTimeout(resolve, 300));
          await one.query("commit");
          assert.equal(await settled, "A reviewer cannot also hold the content role");
          await two.query("rollback");
        } finally {
          one.release();
          two.release();
        }
        // A reviewer who stops being one records nothing more, and may then prepare content.
        await change(reviewer, "reviewer", "revoke");
        await assert.rejects(recordAcceptanceDecision(actor(reviewer), body(4)), { status: 403 });
        await assert.rejects(
          pool.query(
            `insert into valo_acceptance_reviews(corpus,case_id,case_hash,judgment,answer,reason,reviewer)
           values('editorial',$1,$2,'expected_outcome','confirmed','Written after the role was revoked.',$3)`,
            [editorial[4]!.id, editorial[4]!.hash, reviewer],
          ),
          /An active reviewer is required/,
        );
        assert.equal((await change(reviewer, "content")).role, "content");
        // Their decisions stay, as they were written.
        assert.equal(await decisions(), 4);
      },
    );

    await t.test("over HTTP: no caching, same-origin decisions, 201 for a decision", async () => {
      const app = express();
      app.use(express.json());
      app.use(createAcceptanceReviewRouter(async () => actor(lapsed)));
      app.use((e: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) =>
        res.status(e instanceof ValoProblem ? e.status : 422).json({ error: "controlled-boundary-error" }),
      );
      const origin = process.env.VALO_TRUSTED_ORIGIN;
      const server = app.listen(0, "127.0.0.1");
      await new Promise<void>((resolve) => server.once("listening", resolve));
      try {
        const address = server.address();
        const base = `http://127.0.0.1:${typeof address === "object" && address ? address.port : 0}`;
        process.env.VALO_TRUSTED_ORIGIN = base;
        const read = await fetch(`${base}/admin/acceptance-cases?corpus=checker`);
        assert.equal(read.status, 200);
        assert.equal(read.headers.get("cache-control"), "private, no-store");
        const checker = corpusCases("checker");
        const decision = {
          corpus: "checker",
          caseId: checker[0]!.id,
          caseHash: checker[0]!.hash,
          answer: "confirmed",
          reason: "The scenario's expected result follows from the cited section.",
        };
        const hostile = await fetch(`${base}/admin/acceptance-cases/decisions`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Origin: "https://hostile.invalid" },
          body: JSON.stringify(decision),
        });
        assert.equal(hostile.status, 403);
        const saved = await fetch(`${base}/admin/acceptance-cases/decisions`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Origin: base },
          body: JSON.stringify(decision),
        });
        assert.equal(saved.status, 201);
        const listed = (await saved.json()) as {
          cases: { id: string; decision: { reviewer: string } | null }[];
        };
        assert.equal(listed.cases[0]!.decision?.reviewer, lapsed);
      } finally {
        await new Promise<void>((resolve) => server.close(() => resolve()));
        if (origin === undefined) delete process.env.VALO_TRUSTED_ORIGIN;
        else process.env.VALO_TRUSTED_ORIGIN = origin;
      }
    });
  },
);
