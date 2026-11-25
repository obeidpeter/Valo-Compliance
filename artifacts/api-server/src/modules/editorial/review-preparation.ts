import { sql } from "drizzle-orm";
import { isPracticalGuideId } from "@workspace/valo-core";
import { ValoProblem } from "../../platform/valo-problem";
import { assertDevelopmentRuntime } from "../../platform/valo-development-runtime";
import { logger } from "../../platform/logger";
import { captureProviderTerms, mappedGuideIds, supportsOperationalInferenceTemplate } from "../publication";
import { requireSourceStaff, reviewWorkQueue, type SourceStaffActor, type SourceTx } from "../sources";
import { prepareOperationalCandidate } from "./operational-preparation";
import { prepareGuideCandidate } from "./guidance-preparation";

/**
 * A prepared candidate from review work (docs/architecture/source-register.md, slice 4, ADM-003 and
 * CMP-007). A Content editor asks, from an open row on a held template or guide, for its next
 * candidate. The worker then takes a fresh copy of the AI provider's terms, runs the preparer the
 * template's or guide's command runs, with its mechanical checks, and records on the request what came
 * of it. A candidate that passes waits, as every candidate does, for its two reviews, which run only
 * under an AI allocation the owner approves. Nothing here calls a model, sends anything or publishes.
 */

/** The preparer a template or guide is prepared with from review work, if it has one. */
export function reviewPreparer(templateId: string): "template" | "guide" | null {
  if (supportsOperationalInferenceTemplate(templateId) || isPracticalGuideId(templateId)) return "template";
  if (mappedGuideIds.includes(templateId)) return "guide";
  return null;
}
export const reviewPreparable = (templateId: string) => reviewPreparer(templateId) !== null;

function pgCode(error: unknown) {
  const e = error as { cause?: { code?: string }; code?: string };
  return (e.cause ?? e).code;
}
const unmigrated = () =>
  new ValoProblem(503, "Apply the review preparation migration before preparing from review work.");
const busy = () => new ValoProblem(409, "A new candidate is already being prepared from this review work.");

/**
 * A Content editor asks for the next candidate of the held template or guide on an open row. The
 * request waits for the worker; the queue it returns shows it.
 */
export async function requestReviewPreparation(actor: SourceStaffActor, workId: string) {
  assertDevelopmentRuntime();
  const { db } = await import("@workspace/db");
  try {
    return await db.transaction(async (tx) => {
      await requireSourceStaff(tx, actor, "content");
      const [row] = (
        await tx.execute(sql`select w.status,i.target_kind,i.target_key from valo_source_review_work w
          join valo_source_impacts i on i.id=w.impact_id where w.id=${workId}::uuid for update of w`)
      ).rows;
      if (!row) throw new ValoProblem(404, "This review work is not in the queue.");
      if (row.status !== "awaiting_authorized_review")
        throw new ValoProblem(409, "This review work has closed. Reopen the queue.");
      if (row.target_kind !== "content" || !reviewPreparable(String(row.target_key)))
        throw new ValoProblem(
          422,
          "A new candidate is prepared from review work only for a template or guide that has a preparer.",
        );
      const [waiting] = (
        await tx.execute(sql`select 1 from valo_source_review_preparations
          where work_id=${workId}::uuid and status in ('pending','running')`)
      ).rows;
      if (waiting) throw busy();
      await tx.execute(
        sql`insert into valo_source_review_preparations(work_id,requested_by) values(${workId}::uuid,${actor.identityId})`,
      );
      return reviewWorkQueue(tx, { preparable: reviewPreparable });
    });
  } catch (error) {
    // A database the migration has not reached has nowhere to keep the request.
    if (pgCode(error) === "42P01") throw unmigrated();
    // Two requests at once: the unique index lets one through.
    if (pgCode(error) === "23505") throw busy();
    throw error;
  }
}

type Outcome =
  | { status: "prepared"; artifactId: string; version: number }
  | { status: "held"; versionId: string; version: number; reasons: readonly string[] }
  | { status: "not_ready"; version: number; reasons: readonly string[] }
  | { status: "failed"; reasons: readonly string[] }
  | { status: "closed" };
type Claim = { id: string; attempt: number; templateId: string };

/** A code a preparation stopped with, as the commands print it; anything else is not repeated. */
function failureCode(error: unknown) {
  const message = error instanceof Error ? error.message : "";
  return /^[A-Z][A-Z0-9_]{2,79}(?::\S{1,200})?$/.test(message) ? message : "PREPARATION_FAILED";
}
/** What the gate named, kept short enough for the request's record. */
const kept = (reasons: readonly string[]) => {
  const named = [...new Set(reasons.map((reason) => String(reason).slice(0, 160)))];
  return named.length > 20 ? [...named.slice(0, 20), `and ${named.length - 20} more`] : named;
};

async function finish(tx: SourceTx, id: string, attempt: number | null, outcome: Outcome) {
  const reasons = "reasons" in outcome ? kept(outcome.reasons) : [];
  const version = "version" in outcome ? outcome.version : null;
  const artifact = outcome.status === "prepared" ? outcome.artifactId : null;
  const held = outcome.status === "held" ? outcome.versionId : null;
  // A run whose lease passed and was claimed again records nothing: the later run does.
  await tx.execute(sql`update valo_source_review_preparations set status=${outcome.status},lease_until=null,
    completed_at=now(),candidate_artifact_id=${artifact}::uuid,held_version_id=${held}::uuid,
    candidate_version=${version},reasons=${JSON.stringify(reasons)}::jsonb
    where id=${id}::uuid and status in ('pending','running')
    ${attempt === null ? sql`` : sql`and attempts=${attempt}`}`);
}

/** Claims the request waiting longest, or one whose run stopped without finishing. */
async function claim(): Promise<Claim | "settled" | null> {
  const { db } = await import("@workspace/db");
  return db.transaction(async (tx) => {
    const [row] = (
      await tx.execute(sql`select p.id,p.attempts,w.status as work_status,i.target_kind,i.target_key
        from valo_source_review_preparations p join valo_source_review_work w on w.id=p.work_id
        join valo_source_impacts i on i.id=w.impact_id
        where p.status='pending' or (p.status='running' and p.lease_until<now())
        order by p.requested_at,p.id for update of p skip locked limit 1`)
    ).rows;
    if (!row) return null;
    const id = String(row.id);
    // The row closed before its turn came: a later release replaced its version, or it was withdrawn.
    if (row.work_status !== "awaiting_authorized_review") {
      await finish(tx, id, null, { status: "closed" });
      return "settled";
    }
    if (Number(row.attempts) >= 3) {
      await finish(tx, id, null, { status: "failed", reasons: ["PREPARATION_ATTEMPTS_EXHAUSTED"] });
      return "settled";
    }
    const attempt = Number(row.attempts) + 1;
    await tx.execute(sql`update valo_source_review_preparations set status='running',attempts=${attempt},
      lease_until=now()+interval '15 minutes' where id=${id}::uuid`);
    return { id, attempt, templateId: String(row.target_key) };
  });
}

/** Takes the copy of the provider's terms and runs the preparer. No transaction is held meanwhile. */
async function prepare(templateId: string, readPage: Parameters<typeof captureProviderTerms>[0]) {
  const preparer = reviewPreparer(templateId);
  if (!preparer) return { status: "failed", reasons: ["CANDIDATE_REQUEST_PREPARER_UNAVAILABLE"] } as const;
  const { snapshot } = await captureProviderTerms(readPage);
  if (preparer === "template") {
    const result = await prepareOperationalCandidate(templateId, snapshot);
    if (result.candidateArtifact)
      return {
        status: "prepared",
        artifactId: result.candidateArtifact.id,
        version: result.version,
      } as const;
    const reasons = "reasons" in result.release ? result.release.reasons : [];
    return {
      status: "held",
      versionId: result.id,
      version: result.version,
      reasons: reasons.length ? reasons : [result.providerFailure ?? "OPERATIONAL_CANDIDATE_HELD"],
    } as const;
  }
  const result = await prepareGuideCandidate(templateId, snapshot);
  if (result.state === "awaiting_reviews")
    return { status: "prepared", artifactId: result.candidateArtifact.id, version: result.version } as const;
  return { status: "not_ready", version: result.version, reasons: result.reasons } as const;
}

let running: Promise<boolean> | null = null;
/**
 * The worker's `preparations` task: one request per run, the one waiting longest. Its run holds a
 * lease of 15 minutes, and a request is tried at most three times. Returns whether it settled one.
 * `readPage` is for tests; the worker reads the provider's pages through the listed-page fetcher.
 */
export async function prepareRequestedCandidates(
  options: { readPage?: Parameters<typeof captureProviderTerms>[0] } = {},
) {
  assertDevelopmentRuntime();
  // One at a time in this process, even if the queue lets a later run start.
  if (running) return false;
  const run = (async () => {
    let claimed: Awaited<ReturnType<typeof claim>>;
    try {
      claimed = await claim();
    } catch (error) {
      // A database the migration has not reached has no requests to prepare.
      if (pgCode(error) === "42P01") return false;
      throw error;
    }
    if (claimed === null) return false;
    if (claimed === "settled") return true;
    let outcome: Outcome;
    try {
      outcome = await prepare(claimed.templateId, options.readPage);
    } catch (error) {
      outcome = { status: "failed", reasons: [failureCode(error)] };
      // The code only: a preparation's error carries nothing private, but its text is not repeated.
      logger.warn({ event: "review_preparation.failed", code: outcome.reasons[0] });
    }
    const { db } = await import("@workspace/db");
    const { id, attempt } = claimed;
    await db.transaction((tx) => finish(tx, id, attempt, outcome));
    return true;
  })();
  running = run;
  try {
    return await run;
  } finally {
    running = null;
  }
}
