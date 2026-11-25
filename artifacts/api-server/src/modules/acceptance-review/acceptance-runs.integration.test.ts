import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import express from "express";
import { eq, sql } from "drizzle-orm";
import { db, pool, valoStaffAssignments } from "@workspace/db";
import { createAcceptanceReviewRouter } from "../../routes/valo-acceptance-review";
import { ValoProblem } from "../../platform/valo-problem";
import { corpusCases, type AcceptanceCorpus } from "./acceptance-cases";
import { recordAcceptanceDecision } from "./acceptance-review";
import { keepAcceptanceRun, listAcceptanceRun, recordAcceptanceRunDecision } from "./acceptance-runs";
import { hashedKeptCase, type KeptCase } from "./kept-runs";

// EDP-010, RUL-008 and AI-008 (decision 0016, docs/architecture/reviewer-record.md, slice 2): a suite's
// command keeps its run, an active reviewer reads the latest kept run of a corpus, and a decision that
// the run met a case or did not is bound to the run and the case as kept. The database keeps each run
// as written and takes a run decision only on a case a kept run left for a reviewer.
test(
  "runs kept for a reviewer: every case as it stands, decisions bound to the case as kept, and nothing changed after",
  { skip: process.env.VALO_RUN_STAFF_ROLE_TESTS !== "synthetic-development-only", timeout: 60000 },
  async (t) => {
    assert.equal(process.env.NODE_ENV, "development");
    assert.ok(!process.env.REPLIT_DEPLOYMENT);
    const suffix = randomUUID().slice(0, 8);
    const reviewer = `user_synthetic_run_reviewer_${suffix}`,
      editor = `user_synthetic_run_editor_${suffix}`;
    const actor = (identityId: string) => ({ identityId, recentMfa: true, verifiedAt: Date.now() });
    const assignments = [randomUUID(), randomUUID()];
    await db.insert(valoStaffAssignments).values([
      {
        id: assignments[0]!,
        identityId: reviewer,
        role: "reviewer",
        grantedBy: "owned synthetic bootstrap",
        reason: "Disposable test database reviewer",
      },
      {
        id: assignments[1]!,
        identityId: editor,
        role: "content",
        grantedBy: "owned synthetic bootstrap",
        reason: "Disposable test database editor",
      },
    ]);
    t.after(async () => {
      for (const id of assignments)
        await db
          .update(valoStaffAssignments)
          .set({ active: false, version: sql`${valoStaffAssignments.version} + 1` })
          .where(eq(valoStaffAssignments.id, id));
    });
    const review = (caseId: string) => ({
      sections: [{ heading: "The live check", lines: [`result for ${caseId}`, "reason: synthetic"] }],
    });
    /** Every case of a corpus as it stands, the first two left for a reviewer. */
    const run = (corpus: AcceptanceCorpus, left = 2): KeptCase[] =>
      corpusCases(corpus).map((c, i) => ({
        caseId: c.id,
        caseHash: c.hash,
        status: i < left ? "differs" : "matches_expected",
        reason: i < left ? "A synthetic difference." : null,
        review: i < left ? review(c.id) : null,
      }));
    const checker = corpusCases("checker");
    const summary = ["A synthetic live check run."];
    let first = "";

    await t.test(
      "a suite's command keeps a run of every case as it stands, and the run never changes",
      async () => {
        const kept = await keepAcceptanceRun({
          corpus: "checker",
          summary,
          cases: run("checker"),
          operator: "synthetic-operator",
        });
        first = kept.id;
        assert.deepEqual([kept.cases, kept.left], [80, 2]);
        const cases = run("checker");
        for (const bad of [
          cases.slice(1),
          [{ ...cases[0]!, caseHash: "0".repeat(64) }, ...cases.slice(1)],
          [cases[1]!, cases[0]!, ...cases.slice(2)],
        ])
          await assert.rejects(
            keepAcceptanceRun({ corpus: "checker", summary, cases: bad, operator: "synthetic-operator" }),
            /every case of the corpus as it stands/,
          );
        await assert.rejects(
          keepAcceptanceRun({ corpus: "checker", summary, cases, operator: "no" }),
          /Name the operator/,
        );
        await assert.rejects(
          keepAcceptanceRun({
            corpus: "checker",
            summary: Array(21).fill("line"),
            cases,
            operator: "synthetic-operator",
          }),
          /at most 20 lines/,
        );
        await assert.rejects(
          pool.query("update valo_acceptance_runs set summary='[]'::jsonb where id=$1", [first]),
          /A kept run is never changed or removed/,
        );
        await assert.rejects(
          pool.query("delete from valo_acceptance_runs where id=$1", [first]),
          /A kept run is never changed or removed/,
        );
        await assert.rejects(
          pool.query("truncate valo_acceptance_runs"),
          /Audit history cannot be truncated/,
        );
        // Written any other way, a case with a missing field or named twice is refused.
        const direct = (cases: unknown[]) =>
          pool.query(
            `insert into valo_acceptance_runs(corpus,corpus_hash,summary,cases,results_hash,kept_by)
           values('checker',$1,'[]'::jsonb,$2::jsonb,$1,'operator:synthetic-operator')`,
            ["a".repeat(64), JSON.stringify(cases)],
          );
        const one = hashedKeptCase(cases[0]!);
        const { resultHash: _dropped, ...unhashed } = one;
        await assert.rejects(direct([unhashed]), /Each kept case names the case/);
        await assert.rejects(direct([{ ...one, review: "text" }]), /Each kept case names the case/);
        await assert.rejects(direct([one, one]), /A kept run lists each case once/);
      },
    );

    await t.test("only an active reviewer with recent MFA reads the latest kept run", async () => {
      for (const call of [
        () => listAcceptanceRun(actor(editor), "checker"),
        () => listAcceptanceRun(actor(editor), "no-such-corpus"),
        () => listAcceptanceRun({ ...actor(reviewer), recentMfa: false }, "checker"),
        () => recordAcceptanceRunDecision(actor(editor), { anything: true }),
      ])
        await assert.rejects(call(), { status: 403 });
      await assert.rejects(listAcceptanceRun(actor(reviewer), "no-such-corpus"), { status: 404 });
      const view = await listAcceptanceRun(actor(reviewer), "checker");
      assert.equal(view.run?.id, first);
      assert.deepEqual(view.run?.summary, summary);
      assert.equal(view.run?.cases, 80);
      assert.equal(view.run?.keptBy, "operator:synthetic-operator");
      assert.deepEqual(view.run?.statuses, [
        { status: "differs", count: 2 },
        { status: "matches_expected", count: 78 },
      ]);
      assert.deepEqual(
        view.run?.left.map((c) => [c.caseId, c.current, c.decision, c.decisions]),
        [
          [checker[0]!.id, true, null, 0],
          [checker[1]!.id, true, null, 0],
        ],
      );
      assert.deepEqual(view.run?.left[0]?.sections, review(checker[0]!.id).sections);
      assert.equal(view.run?.left[0]?.title, checker[0]!.title);
      assert.equal((await listAcceptanceRun(actor(reviewer), "customer_ai")).run, null);
    });

    await t.test("a decision says why and holds only for the run and the case as kept", async () => {
      const left = (await listAcceptanceRun(actor(reviewer), "checker")).run!.left;
      const body = (rest: Record<string, unknown> = {}) => ({
        corpus: "checker",
        runId: first,
        caseId: left[0]!.caseId,
        caseHash: left[0]!.caseHash,
        resultHash: left[0]!.resultHash,
        answer: "met",
        reason: "The live result follows from the cited section, though the corpus expected another.",
        ...rest,
      });
      const met = await recordAcceptanceRunDecision(actor(reviewer), body());
      assert.equal(met.run?.left[0]?.decision?.answer, "met");
      assert.equal(met.run?.left[0]?.decision?.reviewer, reviewer);
      assert.deepEqual([met.run?.met, met.run?.notMet, met.run?.left[0]?.decisions], [1, 0, 1]);
      await assert.rejects(
        recordAcceptanceRunDecision(actor(reviewer), body({ resultHash: "0".repeat(64) })),
        {
          status: 409,
        },
      );
      await assert.rejects(
        recordAcceptanceRunDecision(actor(reviewer), body({ caseHash: checker[5]!.hash })),
        {
          status: 409,
        },
      );
      await assert.rejects(
        recordAcceptanceRunDecision(
          actor(reviewer),
          body({ caseId: checker[5]!.id, caseHash: checker[5]!.hash }),
        ),
        { status: 404 },
      );
      await assert.rejects(recordAcceptanceRunDecision(actor(reviewer), body({ runId: randomUUID() })), {
        status: 404,
      });
      await assert.rejects(
        recordAcceptanceRunDecision(
          actor(reviewer),
          body({
            corpus: "editorial",
            caseId: corpusCases("editorial")[0]!.id,
            caseHash: corpusCases("editorial")[0]!.hash,
          }),
        ),
        { status: 404 },
      );
      await assert.rejects(recordAcceptanceRunDecision(actor(reviewer), body({ reason: "Too short." })), {
        status: 422,
      });
      await assert.rejects(recordAcceptanceRunDecision(actor(reviewer), body({ answer: "confirmed" })), {
        name: "ZodError",
      });
      // A later decision is added, not written over.
      const notMet = await recordAcceptanceRunDecision(
        actor(reviewer),
        body({
          answer: "not_met",
          reason: "On a second reading the live result misses the exception the case names.",
        }),
      );
      assert.deepEqual(
        [
          notMet.run?.left[0]?.decision?.answer,
          notMet.run?.left[0]?.decisions,
          notMet.run?.met,
          notMet.run?.notMet,
        ],
        ["not_met", 2, 0, 1],
      );
      // A newer run is the one shown; the decisions stay with the run they were made on.
      const newer = await keepAcceptanceRun({
        corpus: "checker",
        summary,
        cases: run("checker", 1),
        operator: "synthetic-operator",
      });
      const view = await listAcceptanceRun(actor(reviewer), "checker");
      assert.equal(view.run?.id, newer.id);
      assert.deepEqual(
        view.run?.left.map((c) => [c.caseId, c.decision]),
        [[checker[0]!.id, null]],
      );
      const onFirst = Number(
        (
          await pool.query<{ n: string }>(
            "select count(*) as n from valo_acceptance_reviews where run_id=$1 and judgment='run_outcome'",
            [first],
          )
        ).rows[0]!.n,
      );
      assert.equal(onFirst, 2);
      // A decision on the earlier run is still about that run, as it was kept.
      await recordAcceptanceRunDecision(
        actor(reviewer),
        body({ caseId: left[1]!.caseId, caseHash: left[1]!.caseHash, resultHash: left[1]!.resultHash }),
      );
    });

    await t.test(
      "the database takes a run decision only on a case a kept run left for a reviewer, as kept",
      async () => {
        const left = (await listAcceptanceRun(actor(reviewer), "checker")).run!;
        const insert = (caseId: string, caseHash: string, runId: string, resultsHash: string) =>
          pool.query(
            `insert into valo_acceptance_reviews(corpus,case_id,case_hash,judgment,run_id,results_hash,answer,reason,reviewer)
           values('checker',$1,$2,'run_outcome',$3,$4,'met','Written straight into the database by a test.',$5)`,
            [caseId, caseHash, runId, resultsHash, reviewer],
          );
        const kept = left.left[0]!;
        const refused =
          /A run decision is taken only on a case a kept run left for a reviewer, as it was kept/;
        await assert.rejects(insert(kept.caseId, kept.caseHash, left.id, "0".repeat(64)), refused);
        await assert.rejects(insert(kept.caseId, kept.caseHash, randomUUID(), kept.resultHash), refused);
        // A case the run left nothing on, with the hash it was kept under.
        const unleft = hashedKeptCase(run("checker", 1)[5]!);
        await assert.rejects(insert(unleft.caseId, unleft.caseHash, left.id, unleft.resultHash), refused);
        assert.equal((await insert(kept.caseId, kept.caseHash, left.id, kept.resultHash)).rowCount, 1);
        // A decision on an expected outcome is taken as before.
        const expected = await recordAcceptanceDecision(actor(reviewer), {
          corpus: "checker",
          caseId: checker[0]!.id,
          caseHash: checker[0]!.hash,
          answer: "confirmed",
          reason: "The expected result follows from the cited section of the Act.",
        });
        assert.equal(expected.cases[0]?.decision?.answer, "confirmed");
      },
    );

    await t.test("over HTTP: no caching, same-origin decisions, 201 for a decision", async () => {
      const app = express();
      app.use(express.json());
      app.use(createAcceptanceReviewRouter(async () => actor(reviewer)));
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
        const read = await fetch(`${base}/admin/acceptance-runs?corpus=checker`);
        assert.equal(read.status, 200);
        assert.equal(read.headers.get("cache-control"), "private, no-store");
        const view = (await read.json()) as {
          run: { id: string; left: { caseId: string; caseHash: string; resultHash: string }[] };
        };
        const kept = view.run.left[0]!;
        const decision = {
          corpus: "checker",
          runId: view.run.id,
          caseId: kept.caseId,
          caseHash: kept.caseHash,
          resultHash: kept.resultHash,
          answer: "not_met",
          reason: "The live result leaves out the exception the scenario names.",
        };
        const hostile = await fetch(`${base}/admin/acceptance-runs/decisions`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Origin: "https://hostile.invalid" },
          body: JSON.stringify(decision),
        });
        assert.equal(hostile.status, 403);
        const saved = await fetch(`${base}/admin/acceptance-runs/decisions`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Origin: base },
          body: JSON.stringify(decision),
        });
        assert.equal(saved.status, 201);
      } finally {
        await new Promise<void>((resolve) => server.close(() => resolve()));
        if (origin === undefined) delete process.env.VALO_TRUSTED_ORIGIN;
        else process.env.VALO_TRUSTED_ORIGIN = origin;
      }
    });
  },
);
