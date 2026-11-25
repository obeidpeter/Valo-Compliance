import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { eq, sql } from "drizzle-orm";
import { digest } from "@workspace/valo-core";
import { db, pool, valoStaffAssignments } from "@workspace/db";
import { parseScoreArguments, scoreAcceptanceRun } from "../../scripts/acceptance-score";
import { corpusCases } from "./acceptance-cases";
import { recordAcceptanceDecision } from "./acceptance-review";
import {
  acceptanceScore,
  keepAcceptanceRun,
  listAcceptanceRun,
  recordAcceptanceRunDecision,
} from "./acceptance-runs";
import type { KeptCase } from "./kept-runs";

// EDP-010, RUL-008 and AI-008 (decision 0016, docs/architecture/reviewer-record.md, slice 3): a kept run
// scored with the reviewer's record as the database holds it, the rows the score used, and the record
// exported for a report. Synthetic identities and cases only; nothing here accepts anything.
test("arguments: a corpus is named, and each option at most once", () => {
  assert.deepEqual(parseScoreArguments(["--corpus", "checker"]), { corpus: "checker" });
  assert.deepEqual(parseScoreArguments(["--run", "r", "--corpus", "editorial", "--export", "f.json"]), {
    run: "r",
    corpus: "editorial",
    exportTo: "f.json",
  });
  for (const bad of [[], ["--run", "r"], ["--corpus"], ["--corpus", "a", "--corpus", "b"], ["--other", "x"]])
    assert.throws(() => parseScoreArguments(bad), /usage: acceptance-score.ts/);
});

test(
  "a kept run scored with the record: confirmed and met or passed counts, rejected is out, and the score names the rows it used",
  { skip: process.env.VALO_RUN_STAFF_ROLE_TESTS !== "synthetic-development-only", timeout: 60000 },
  async (t) => {
    assert.equal(process.env.NODE_ENV, "development");
    const reviewer = `user_synthetic_score_reviewer_${randomUUID().slice(0, 8)}`;
    const assignment = randomUUID();
    await db.insert(valoStaffAssignments).values({
      id: assignment,
      identityId: reviewer,
      role: "reviewer",
      grantedBy: "owned synthetic bootstrap",
      reason: "Disposable test database reviewer",
    });
    const folder = await mkdtemp(join(tmpdir(), "acceptance-score-"));
    t.after(async () => {
      await db
        .update(valoStaffAssignments)
        .set({ active: false, version: sql`${valoStaffAssignments.version} + 1` })
        .where(eq(valoStaffAssignments.id, assignment));
      await rm(folder, { recursive: true, force: true });
    });
    const actor = { identityId: reviewer, recentMfa: true, verifiedAt: Date.now() };
    const checker = corpusCases("checker");
    // The first two scenarios are left for a reviewer; the suite passes the rest itself.
    const cases: KeptCase[] = checker.map((c, i) => ({
      caseId: c.id,
      caseHash: c.hash,
      status: i < 2 ? "differs" : "matches_expected",
      reason: null,
      review: i < 2 ? { sections: [{ heading: "The live check", lines: [`result for ${c.id}`] }] } : null,
    }));
    const kept = await keepAcceptanceRun({
      corpus: "checker",
      summary: ["A synthetic run."],
      cases,
      operator: "synthetic-operator",
    });
    const decide = (i: number, answer: "confirmed" | "rejected") =>
      recordAcceptanceDecision(actor, {
        corpus: "checker",
        caseId: checker[i]!.id,
        caseHash: checker[i]!.hash,
        answer,
        reason: "A synthetic decision on the scenario's expected result.",
      });
    for (const i of [0, 1, 2, 3, 4]) await decide(i, "confirmed");
    await decide(5, "rejected");
    const left = (await listAcceptanceRun(actor, "checker")).run!.left;
    const onRun = (i: number, answer: "met" | "not_met") =>
      recordAcceptanceRunDecision(actor, {
        corpus: "checker",
        runId: kept.id,
        caseId: left[i]!.caseId,
        caseHash: left[i]!.caseHash,
        resultHash: left[i]!.resultHash,
        answer,
        reason: "A synthetic decision on the run's result for the scenario.",
      });
    await onRun(0, "met");
    await onRun(1, "not_met");
    // A decision on other words of a case is not one on these words.
    await pool.query(
      `insert into valo_acceptance_reviews(corpus,case_id,case_hash,judgment,answer,reason,reviewer)
       values('checker',$1,$2,'expected_outcome','confirmed','A decision on the earlier words of this case.',$3)`,
      [checker[6]!.id, "0".repeat(64), reviewer],
    );

    await t.test("the score counts what the record allows, and names the rows it used", async () => {
      const { run, score } = await acceptanceScore("checker", kept.id);
      assert.equal(run.id, kept.id);
      const outcome = (i: number) => score.byCase.find((c) => c.caseId === checker[i]!.id)!;
      assert.deepEqual(
        [0, 1, 2, 5, 6].map((i) => [outcome(i).outcome, outcome(i).because]),
        [
          ["counted", "confirmed_and_met_in_this_run"],
          ["not_counted", "run_recorded_as_not_met"],
          ["counted", "confirmed_and_passed_by_the_suite"],
          ["excluded", "expected_outcome_rejected"],
          ["not_counted", "expected_outcome_not_confirmed"],
        ],
      );
      assert.deepEqual(
        [
          score.cases,
          score.excluded,
          score.scored,
          score.counted,
          score.required,
          score.meetsBar,
          score.accepted,
        ],
        [80, 1, 79, 4, 79, false, false],
      );
      // Five confirmations, one rejection, and the two decisions on the run.
      assert.equal(score.rows.length, 8);
      for (const row of score.record) {
        const { hash, ...asRead } = row;
        assert.equal(hash, digest(asRead));
        assert.ok(row.reviewer === reviewer);
      }
      assert.ok(
        !score.record.some((row) => row.caseHash === "0".repeat(64)),
        "a decision on other words is not used",
      );
      // The page shows the same score for the latest kept run.
      const listed = (await listAcceptanceRun(actor, "checker")).run!.score;
      assert.deepEqual(
        [listed.scored, listed.counted, listed.excluded, listed.required, listed.meetsBar, listed.recordHash],
        [79, 4, 1, 79, false, score.recordHash],
      );
    });

    await t.test(
      "the latest kept run is scored unless one is named, and the record a score used is exported",
      async () => {
        const newer = await keepAcceptanceRun({
          corpus: "checker",
          summary: ["A later synthetic run."],
          cases,
          operator: "synthetic-operator",
        });
        const latest = await acceptanceScore("checker");
        assert.equal(latest.run.id, newer.id);
        // The decisions on the earlier run are not decisions on this one.
        const first = latest.score.byCase.find((c) => c.caseId === checker[0]!.id)!;
        assert.deepEqual([first.outcome, first.because], ["not_counted", "run_not_recorded_as_met"]);
        assert.equal((await acceptanceScore("checker", kept.id)).run.id, kept.id);
        await assert.rejects(
          acceptanceScore("checker", randomUUID()),
          /There is no such kept run of this corpus/,
        );
        const file = join(folder, "score.json");
        const printed = await scoreAcceptanceRun({ corpus: "checker", run: kept.id, exportTo: file });
        assert.equal(printed.counted, 4);
        assert.equal(printed.byOutcome.excluded!.length, 1);
        const exported = JSON.parse(await readFile(file, "utf8")) as {
          run: { id: string };
          score: { record: unknown[]; recordHash: string };
        };
        assert.equal(exported.run.id, kept.id);
        assert.equal(exported.score.record.length, 8);
        assert.equal(exported.score.recordHash, printed.recordHash);
        // An export never writes over another.
        await assert.rejects(
          scoreAcceptanceRun({ corpus: "checker", run: kept.id, exportTo: file }),
          /EEXIST/,
        );
      },
    );
  },
);
