import { sql } from "drizzle-orm";
import { digest } from "@workspace/valo-core";
import { RecordAcceptanceRunDecisionBody } from "@workspace/api-zod";
import { ValoProblem } from "../../platform/valo-problem";
import { assertDevelopmentRuntime } from "../../platform/valo-development-runtime";
import type { StaffActor } from "../staff";
import { corpusCases, corpusFileHash, type AcceptanceCorpus } from "./acceptance-cases";
import { asReviewer, corpusOf, iso, type Tx } from "./acceptance-review";
import { hashedKeptCase, type HashedKeptCase, type KeptCase } from "./kept-runs";
import { scoreKeptRun, type RecordRow } from "./reviewed-score";

/**
 * Runs kept for an independent reviewer (decision 0016, docs/architecture/reviewer-record.md, slice 2).
 * A suite's command keeps its run; an active reviewer reads the latest kept run of a corpus and records
 * whether it met each case it left for a reviewer, bound to the run and the hash of the case as kept.
 */
const OPERATOR = /^[A-Za-z0-9._@-]{3,80}$/;

/**
 * Keeps a suite's run: every case of the corpus as it stands, in order, each with the suite's status
 * and what it left for a reviewer. Operator commands only, in development.
 */
export async function keepAcceptanceRun(input: {
  corpus: AcceptanceCorpus;
  summary: string[];
  cases: KeptCase[];
  operator: string;
}) {
  assertDevelopmentRuntime();
  if (!OPERATOR.test(input.operator))
    throw new Error("Name the operator who keeps the run with 3-80 letters, digits or . _ @ -.");
  if (input.summary.length > 20 || input.summary.some((line) => !line.trim() || line.length > 500))
    throw new Error("A kept run's summary is at most 20 lines of at most 500 characters.");
  const current = corpusCases(input.corpus);
  if (
    input.cases.length !== current.length ||
    input.cases.some((kept, i) => kept.caseId !== current[i]!.id || kept.caseHash !== current[i]!.hash)
  )
    throw new Error("A kept run lists every case of the corpus as it stands, in the corpus's order.");
  const cases = input.cases.map(hashedKeptCase);
  const resultsHash = digest(cases);
  const { db } = await import("@workspace/db");
  const [row] = (
    await db.execute(sql`insert into valo_acceptance_runs(corpus,corpus_hash,summary,cases,results_hash,kept_by)
      values(${input.corpus},${corpusFileHash(input.corpus)},${JSON.stringify(input.summary)}::jsonb,
        ${JSON.stringify(cases)}::jsonb,${resultsHash},${`operator:${input.operator}`})
      returning id`)
  ).rows;
  return {
    id: String(row!.id),
    resultsHash,
    cases: cases.length,
    left: cases.filter((kept) => kept.review !== null).length,
  };
}

function migrated<T>(work: Promise<T>) {
  return work.catch((error: unknown) => {
    const e = error as { cause?: { code?: string }; code?: string };
    // A database the runs migration has not reached has no kept run to read or decide on.
    if ((e.cause ?? e).code === "42P01")
      throw new ValoProblem(503, "Apply the acceptance runs migration before reading kept runs.");
    throw error;
  });
}

/** A kept run scored with the record: every expected outcome decided on the corpus, and the run's own decisions. */
async function scoreOf(
  tx: Pick<Tx, "execute">,
  corpus: AcceptanceCorpus,
  run: { id: string; resultsHash: string; cases: HashedKeptCase[] },
) {
  const rows = (
    await tx.execute(sql`select id,judgment,case_id,case_hash,run_id,results_hash,answer,reason,reviewer,created_at
      from valo_acceptance_reviews where corpus=${corpus} and (judgment='expected_outcome' or run_id=${run.id})`)
  ).rows;
  return scoreKeptRun(
    corpus,
    run,
    rows.map((row): RecordRow => ({
      id: String(row.id),
      judgment: String(row.judgment) as RecordRow["judgment"],
      caseId: String(row.case_id),
      caseHash: String(row.case_hash),
      runId: row.run_id === null ? null : String(row.run_id),
      resultsHash: row.results_hash === null ? null : String(row.results_hash),
      answer: String(row.answer) as RecordRow["answer"],
      reason: String(row.reason),
      reviewer: String(row.reviewer),
      createdAt: iso(row.created_at),
    })),
  );
}

/**
 * A kept run of a corpus scored with the reviewer's record (slice 3): the latest kept run, or the one
 * named, read in one snapshot. Operator commands only, in development; it writes nothing.
 */
export async function acceptanceScore(corpus: AcceptanceCorpus, runId?: string) {
  assertDevelopmentRuntime();
  const { db } = await import("@workspace/db");
  return migrated(
    db.transaction(async (tx) => {
      await tx.execute(sql`set transaction isolation level repeatable read, read only`);
      const [run] = (
        runId
          ? await tx.execute(sql`select id,summary,cases,results_hash,kept_by,created_at from valo_acceptance_runs
              where id::text=${runId} and corpus=${corpus}`)
          : await tx.execute(sql`select id,summary,cases,results_hash,kept_by,created_at from valo_acceptance_runs
              where corpus=${corpus} order by created_at desc,id desc limit 1`)
      ).rows;
      if (!run)
        throw new Error(
          runId ? "There is no such kept run of this corpus." : "No run of this corpus is kept.",
        );
      const kept = {
        id: String(run.id),
        resultsHash: String(run.results_hash),
        cases: run.cases as HashedKeptCase[],
      };
      return {
        run: {
          id: kept.id,
          keptBy: String(run.kept_by),
          createdAt: iso(run.created_at),
          resultsHash: kept.resultsHash,
          summary: run.summary as string[],
        },
        score: await scoreOf(tx, corpus, kept),
      };
    }),
  );
}

/** The latest kept run of a corpus, with the latest decision on each case it left for a reviewer. */
async function latestRun(tx: Tx, corpus: AcceptanceCorpus) {
  const [run] = (
    await tx.execute(sql`select id,summary,cases,results_hash,kept_by,created_at from valo_acceptance_runs
      where corpus=${corpus} order by created_at desc,id desc limit 1`)
  ).rows;
  if (!run) return { corpus, run: null };
  const runId = String(run.id);
  const rows = (
    await tx.execute(sql`select distinct on (case_id,results_hash) case_id,results_hash,answer,reason,reviewer,created_at,
      count(*) over (partition by case_id,results_hash)::int as decisions
      from valo_acceptance_reviews where corpus=${corpus} and judgment='run_outcome' and run_id=${runId}
      order by case_id,results_hash,created_at desc,id desc`)
  ).rows;
  const latest = new Map(rows.map((row) => [`${String(row.case_id)} ${String(row.results_hash)}`, row]));
  const corpusNow = new Map(corpusCases(corpus).map((item) => [item.id, item]));
  const cases = run.cases as HashedKeptCase[];
  const statuses = new Map<string, number>();
  for (const kept of cases) statuses.set(kept.status, (statuses.get(kept.status) ?? 0) + 1);
  const left = cases
    .filter((kept) => kept.review !== null || kept.status === "needs_evaluator_decision")
    .map((kept) => {
      const row = latest.get(`${kept.caseId} ${kept.resultHash}`);
      const now = corpusNow.get(kept.caseId);
      return {
        caseId: kept.caseId,
        caseHash: kept.caseHash,
        title: now?.title ?? kept.caseId,
        status: kept.status,
        reason: kept.reason,
        sections: kept.review?.sections ?? null,
        resultHash: kept.resultHash,
        current: now?.hash === kept.caseHash,
        decision: row
          ? {
              answer: String(row.answer) as "met" | "not_met",
              reason: String(row.reason),
              reviewer: String(row.reviewer),
              createdAt: iso(row.created_at),
            }
          : null,
        decisions: row ? Number(row.decisions) : 0,
      };
    });
  const score = await scoreOf(tx, corpus, { id: runId, resultsHash: String(run.results_hash), cases });
  return {
    corpus,
    run: {
      id: runId,
      keptBy: String(run.kept_by),
      createdAt: iso(run.created_at),
      resultsHash: String(run.results_hash),
      summary: run.summary as string[],
      cases: cases.length,
      statuses: [...statuses].map(([status, count]) => ({ status, count })),
      left,
      met: left.filter((item) => item.decision?.answer === "met").length,
      notMet: left.filter((item) => item.decision?.answer === "not_met").length,
      // The run scored with the record (slice 3). Nothing here accepts a requirement.
      score: {
        scored: score.scored,
        counted: score.counted,
        excluded: score.excluded,
        notCounted: score.notCounted,
        required: score.required,
        critical: score.critical,
        meetsBar: score.meetsBar,
        recordHash: score.recordHash,
      },
    },
  };
}

/** The latest kept run of a corpus for an active reviewer. Other staff learn nothing of the runs. */
export function listAcceptanceRun(actor: StaffActor, corpus: unknown) {
  return migrated(asReviewer(actor, (tx) => latestRun(tx, corpusOf(corpus))));
}

/**
 * A reviewer records whether a kept run met one of the cases it left for a reviewer, with why, for the
 * run and the case as kept. A case whose words changed since the run, or a hash that is not the case as
 * kept, is refused: the decision would be about another result.
 */
export async function recordAcceptanceRunDecision(actor: StaffActor, value: unknown) {
  // Refuse callers who are not reviewers before reading their input; the transaction below checks again.
  await asReviewer(actor, async () => undefined);
  const body = RecordAcceptanceRunDecisionBody.strict().parse(value);
  const reason = body.reason.trim();
  if (reason.length < 20 || reason.length > 2000)
    throw new ValoProblem(422, "Say why, in 20 to 2,000 characters.");
  const current = corpusCases(body.corpus).find((item) => item.id === body.caseId);
  if (!current) throw new ValoProblem(404, "This case is not in the corpus.");
  if (current.hash !== body.caseHash)
    throw new ValoProblem(409, "This case changed since you read it. Reopen the cases and read it again.");
  return migrated(
    asReviewer(actor, async (tx) => {
      const [run] = (
        await tx.execute(
          sql`select cases from valo_acceptance_runs where id::text=${body.runId} and corpus=${body.corpus}`,
        )
      ).rows;
      if (!run) throw new ValoProblem(404, "There is no such kept run of this corpus.");
      const kept = (run.cases as HashedKeptCase[]).find((item) => item.caseId === body.caseId);
      if (!kept?.review) throw new ValoProblem(404, "This run left nothing on this case for a reviewer.");
      const { resultHash, ...asKept } = kept;
      if (hashedKeptCase(asKept).resultHash !== resultHash)
        throw new ValoProblem(
          409,
          "This run's record of the case does not match its hash. Nothing was recorded.",
        );
      if (kept.caseHash !== body.caseHash)
        throw new ValoProblem(409, "This run is of other words of the case. Read the case as it stands.");
      if (resultHash !== body.resultHash)
        throw new ValoProblem(409, "This is not the result you read. Reopen the run and read it again.");
      await tx.execute(sql`insert into valo_acceptance_reviews(corpus,case_id,case_hash,judgment,run_id,results_hash,answer,reason,reviewer)
        values(${body.corpus},${body.caseId},${body.caseHash},'run_outcome',${body.runId},${resultHash},${body.answer},${reason},${actor.identityId})`);
      return latestRun(tx, body.corpus);
    }),
  );
}
