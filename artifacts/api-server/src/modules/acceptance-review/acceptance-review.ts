import { and, eq, sql } from "drizzle-orm";
import { RecordAcceptanceDecisionBody } from "@workspace/api-zod";
import { ValoProblem } from "../../platform/valo-problem";
import { assertDevelopmentRuntime } from "../../platform/valo-development-runtime";
import {
  activeStaffAssignment,
  assertStaffAssignmentCurrent,
  requireFreshStaffSession,
  type StaffActor,
} from "../staff";
import {
  confirmationClaim,
  corpusCases,
  isAcceptanceCorpus,
  type AcceptanceCorpus,
} from "./acceptance-cases";

/**
 * The reviewer's record (decision 0016, docs/architecture/reviewer-record.md, slice 1): an active
 * reviewer with recent MFA reads a corpus's cases with the latest decision on each case's current hash,
 * and confirms or rejects a case's expected outcome, with why. The database keeps every decision.
 */
type Tx = Parameters<Parameters<Awaited<typeof import("@workspace/db")>["db"]["transaction"]>[0]>[0];

/** The active reviewer assignment of the caller, under a shared lock until the transaction ends. */
export async function requireReviewer(tx: Tx, actor: StaffActor) {
  const { valoStaffAssignments } = await import("@workspace/db");
  requireFreshStaffSession(actor);
  const [role] = await tx
    .select()
    .from(valoStaffAssignments)
    .where(
      and(
        eq(valoStaffAssignments.identityId, actor.identityId),
        eq(valoStaffAssignments.role, "reviewer"),
        activeStaffAssignment(),
      ),
    )
    .for("share");
  if (!role)
    throw new ValoProblem(
      403,
      "An active reviewer assignment is required. Other staff roles cannot record acceptance decisions.",
    );
  await assertStaffAssignmentCurrent(tx, role.id);
  requireFreshStaffSession(actor);
  return role;
}

function pgCode(error: unknown) {
  const e = error as { cause?: { code?: string }; code?: string };
  return (e.cause ?? e).code;
}
const iso = (value: unknown) => (value instanceof Date ? value : new Date(String(value))).toISOString();
function corpusOf(value: unknown): AcceptanceCorpus {
  if (!isAcceptanceCorpus(value)) throw new ValoProblem(404, "There is no such set of acceptance cases.");
  return value;
}

/** The corpus's cases, each with the latest decision on its current hash and how many it has had. */
async function casesWithDecisions(tx: Tx, corpus: AcceptanceCorpus) {
  const cases = corpusCases(corpus);
  const rows = (
    await tx.execute(sql`select distinct on (case_id,case_hash) case_id,case_hash,answer,reason,reviewer,created_at,
      count(*) over (partition by case_id,case_hash)::int as decisions
      from valo_acceptance_reviews where corpus=${corpus} and judgment='expected_outcome'
      order by case_id,case_hash,created_at desc,id desc`)
  ).rows;
  const latest = new Map(rows.map((row) => [`${String(row.case_id)} ${String(row.case_hash)}`, row]));
  const listed = cases.map((item) => {
    const row = latest.get(`${item.id} ${item.hash}`);
    return {
      ...item,
      decision: row
        ? {
            answer: String(row.answer) as "confirmed" | "rejected",
            reason: String(row.reason),
            reviewer: String(row.reviewer),
            createdAt: iso(row.created_at),
          }
        : null,
      decisions: row ? Number(row.decisions) : 0,
    };
  });
  return {
    corpus,
    claim: confirmationClaim,
    cases: listed,
    confirmed: listed.filter((item) => item.decision?.answer === "confirmed").length,
    rejected: listed.filter((item) => item.decision?.answer === "rejected").length,
  };
}

async function asReviewer<T>(actor: StaffActor, work: (tx: Tx) => Promise<T>) {
  assertDevelopmentRuntime();
  const { db } = await import("@workspace/db");
  try {
    return await db.transaction(async (tx) => {
      await requireReviewer(tx, actor);
      return work(tx);
    });
  } catch (error) {
    // A database the migration has not reached has no reviewer role and no record.
    if (pgCode(error) === "42P01")
      throw new ValoProblem(503, "Apply the acceptance review migration before recording decisions.");
    throw error;
  }
}

/** A corpus's cases for an active reviewer. Other staff learn nothing of the corpora's names. */
export function listAcceptanceCases(actor: StaffActor, corpus: unknown) {
  return asReviewer(actor, (tx) => casesWithDecisions(tx, corpusOf(corpus)));
}

/**
 * A reviewer confirms or rejects a case's expected outcome, with why, for the case's hash as the
 * reviewer read it. A case that changed since is refused: the decision would be about other words.
 */
export async function recordAcceptanceDecision(actor: StaffActor, value: unknown) {
  // Refuse callers who are not reviewers before reading their input; the transaction below checks again.
  await asReviewer(actor, async () => undefined);
  const body = RecordAcceptanceDecisionBody.strict().parse(value);
  const reason = body.reason.trim();
  if (reason.length < 20 || reason.length > 2000)
    throw new ValoProblem(422, "Say why, in 20 to 2,000 characters.");
  const current = corpusCases(body.corpus).find((item) => item.id === body.caseId);
  if (!current) throw new ValoProblem(404, "This case is not in the corpus.");
  if (current.hash !== body.caseHash)
    throw new ValoProblem(409, "This case changed since you read it. Reopen the cases and read it again.");
  return asReviewer(actor, async (tx) => {
    await tx.execute(sql`insert into valo_acceptance_reviews(corpus,case_id,case_hash,judgment,answer,reason,reviewer)
      values(${body.corpus},${body.caseId},${body.caseHash},'expected_outcome',${body.answer},${reason},${actor.identityId})`);
    return casesWithDecisions(tx, body.corpus);
  });
}
